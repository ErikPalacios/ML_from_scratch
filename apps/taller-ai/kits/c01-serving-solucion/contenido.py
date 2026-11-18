"""Arma content/estaciones/c01-serving.json con las salidas reales de probar.sh y probar-fallas.sh.

    bash probar.sh /tmp/e6 && bash probar-fallas.sh /tmp/e6     # deja /tmp/e6.log y /tmp/e6-fallas.log
    python3 contenido.py /tmp/e6                                 # escribe el JSON con esas salidas

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
    lineas = m.group(1).rstrip("\n").replace(RUTA, "~/c01-serving").splitlines()
    lineas = [l for l in lineas if "View run" not in l and "View experiment" not in l and "mlflow.store.model_registry" not in l]
    lineas = [re.sub(r"^([IEW])\d{4} \d\d:\d\d:\d\d\.\d+ \d+ servidor\.py\] ", r"\1 ", l) for l in lineas]
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


def cmd(code_, salida, nota="", donde="mac"):
    return {"code": code_, "nota": nota, "donde": donde, "salida": salida}


def num(nombre: str, rx: str, log: str = None) -> str:
    m = re.search(rx, L(nombre, log))
    if not m:
        sys.exit(f"no encontré {rx!r} en «{nombre}»")
    return m.group(1)


V = "python verificar.py"
CREAR_S = num("p0 crear", r"(?m)^real (\d+)")
FOTOS_S = num("p5 verificar", r"(\d+) fotos/s con 8 a la vez")
BATCH = num("p5 batch", r"([\d.]+) fotos por batch")
RSS = num("p5 memoria", r"ocupa (\d+) MiB")
T504 = num("p7 congelado", r"classify → 504 en ([\d.]+) s")
PRUEBAS = num("p8 pytest", r"(\d+) passed")
PYTEST_S = num("p8 pytest", r"(?m)^real ([\d.]+)")
LINEA_B = num("p8 linea", r"(\d+) B en una línea")
KB_ENG = num("p2 armar", r"· (\d+) kB ·")

e = {
    "id": "serving", "patron": "sincrono", "caso": "c01", "num": 6,
    "titulo": "Código de serving", "nav": "Código de serving",
    "pregunta": "El modelo ya está compilado y registrado. ¿Qué programa lo pone a responder fotos por la red, sin caerse cuando llega una foto rara, cuando sube el tráfico o cuando el servidor del modelo se traba?",
    "version": "2026-11-17",
}

e["mapa"] = {
    "resumen": "La estación 5 dejó a <code>classifier</code> v4 con su <b>engine</b> y sus huellas en el registro. Falta lo que lo pone a atender: dos programas. El <b>servidor de modelos</b> (Triton) carga el engine desde una carpeta, el <b>model repository</b>, con su <code>config.pbtxt</code>, y solo convierte tensores en tensores, juntando fotos en lotes. Delante va el <b>gateway</b>, un programa en FastAPI que recibe cada foto, la revisa de lo barato a lo caro, la prepara con topes de memoria y de concurrencia, le pide los logits a Triton con un plazo que nunca pasa del que le queda, y contesta siempre con un código que dice qué pasó, dejando una línea de log y sus métricas. Con sus pruebas, que corren sin GPU.",
    "entra": [
        "el engine de <code>classifier</code> v4 y su <code>labels.json</code>, por número, con las huellas del registro",
        "el preprocess compartido con el entrenamiento (el mismo código, la misma Pillow)",
        "las reglas del gateway (<code>gateway.yaml</code>): tipos, tamaños, topes y la cadena de plazos, revisadas en un PR",
        "el contrato con quien llama: <code>POST /v1/classify?top_k=5</code> con los bytes de la foto; la app espera 300 ms",
    ],
    "sale": [
        "el model repository: <code>classifier/config.pbtxt</code> y <code>classifier/1/model.onnx</code>, la copia exacta del engine aprobado",
        "el gateway: <code>/v1/classify</code>, <code>/healthz</code>, <code>/readyz</code> y <code>/metrics</code>, con el código de cada falla",
        "una línea de log en JSON por request y las métricas con nombres fijos",
        f"{PRUEBAS} pruebas con un Triton falso, que corren en segundos sin GPU",
    ],
    "escala": [
        {"que": "El servidor de modelos", "c01": "Triton con TensorRT en una T4 por zona; <code>platform: \"tensorrt_plan\"</code>, <code>KIND_GPU</code>", "taller": "el servidor del dojo (<code>mundo/triton_dojo/</code>) con ONNX Runtime en tu CPU; <code>platform: \"onnxruntime_onnx\"</code>, <code>KIND_CPU</code>. Lee el mismo <code>config.pbtxt</code> y habla el mismo protocolo HTTP"},
        {"que": "El modelo", "c01": "ResNet-50: <code>input</code> [3, 224, 224] → <code>logits</code> [500], batch hasta 32", "taller": f"MiniResNet: <code>input</code> [3, 32, 32] → <code>logits</code> [10], batch hasta 32 (engine de {KB_ENG} kB)"},
        {"que": "El gateway", "c01": "FastAPI en 3 a 12 copias de 1 vCPU y 1 GiB, detrás del ALB", "taller": "el mismo código, un proceso en tu Mac (<code>mundo/servicios.py</code>) en el puerto 8701"},
        {"que": "Quién llama", "c01": "la app, con su token verificado por el ALB; ≈ 500 fotos/s en el pico", "taller": f"<code>curl</code> y <code>verificar.py</code> (≈ {FOTOS_S} fotos/s con 8 a la vez)"},
        {"que": "Los límites y plazos", "c01": "10 MiB, 40 MP, 1:8, 2 decodes, 16 en vuelo · 300 > 250 > 150 > 100 ms", "taller": "los mismos, en <code>gateway.yaml</code>"},
        {"que": "Las pruebas", "c01": "26 pruebas con pytest y un Triton falso, ≈ 2 min en CI", "taller": f"{PRUEBAS} pruebas, ≈ {round(float(PYTEST_S))} s"},
    ],
    "hoja": "https://cheat-sheets-ml.vercel.app/recorrido/#est-serving",
}

e["precalculos"] = {
    "intro": "Antes de escribir el gateway, las cuentas de servilleta: cuánta memoria pide una copia en el peor momento, cuántas requests caben adentro, cuánto plazo le queda a la llamada a Triton, cuántas fotos junta Triton en un lote, cuánto pesa lo que viaja por la red y cuánto log sale al día. Cada cuenta va en las dos escalas: C01 y el dojo.",
    "cuentas": [
        {
            "id": "memoria", "pregunta": "¿Cuánta memoria pide una copia del gateway en el peor momento?",
            "formula": "pico = en vuelo × body máximo + decodes × píxeles máximos × 4 B × 2 copias + lo que ocupa el proceso",
            "c01": {"cuenta": "16 × 10 MiB + 2 × 40 MP × 4 B × 2 + ≈ 150 MiB", "valor": "≈ 160 + 610 + 150 ≈ 920 MiB: cabe en 1 GiB"},
            "taller": {"cuenta": "las mismas reglas; con 64 en vuelo y 8 decodes", "valor": "≈ 920 MiB · con 64 y 8: ≈ 3,200 MiB, más del triple"},
            "decide": "Los topes salen de la memoria del peor caso, no de la CPU de hoy. Con 16 en vuelo y 2 decodes, una ráfaga de fotos de 40 MP todavía cabe en 1 GiB; con 64 y 8, el proceso muere por memoria (OOM) y se lleva a todas las requests que tenía adentro.",
            "conceptos": ["en-vuelo", "semaforo"],
            "comprueba": cmd("python -c \"\nMiB = 2**20\nfor nombre, en_vuelo, decodes in [('C01 y el dojo (gateway.yaml)', 16, 2), ('con 64 en vuelo y 8 decodes', 64, 8)]:\n    bodies = en_vuelo * 10 * MiB\n    decode = decodes * 40_000_000 * 4 * 2\n    print(f'{nombre}: bodies {en_vuelo} × 10 MiB = {bodies / MiB:,.0f} MiB · decodes {decodes} × 40 MP × 4 B × 2 copias = {decode / MiB:,.0f} MiB · total {(bodies + decode) / MiB:,.0f} MiB + el proceso')\"", L("pc memoria")),
            "confirma": f"el paso 5: el gateway ocupa {RSS} MiB sin requests (C01 redondea a ≈ 150 MiB), y el check <code>reglas</code> hace la misma cuenta con <code>gateway.yaml</code>.",
        },
        {
            "id": "little", "pregunta": "¿Cuántas requests hay adentro de una copia a la vez?",
            "formula": "en vuelo = llegadas por segundo × lo que dura cada una (la Ley de Little)",
            "c01": {"cuenta": "100/s × 50 ms; si se alargan, 100/s × 200 ms", "valor": "5 normalmente · 20 en el caso lento → tope de 16, recortado por la memoria"},
            "taller": {"cuenta": f"verificar manda ≈ {FOTOS_S}/s con 8 a la vez, de ≈ 10 ms cada una", "valor": "≈ 8 adentro: nunca toca el tope de 16"},
            "decide": "El tope tiene que dejar pasar el tráfico normal con margen y rechazar al instante lo que de todas formas llegaría tarde. Rechazar la 17 cuesta microsegundos; aceptarla arriesga la memoria y alarga a todas las demás.",
            "conceptos": ["en-vuelo"],
            "comprueba": cmd("python -c \"\nfor nombre, llegan, dura in [('C01, una copia, requests normales', 100, 0.050), ('C01, una copia, requests lentas', 100, 0.200), ('dojo, verificar responde (8 a la vez)', 800, 0.010)]:\n    print(f'{nombre}: {llegan}/s × {dura * 1000:.0f} ms = {llegan * dura:.0f} en vuelo')\"", L("pc little")),
            "confirma": "el paso 6: el check <code>topes</code> manda 20 a la vez contra un Triton lento y entran 16.",
        },
        {
            "id": "plazo", "pregunta": "¿Cuánto plazo recibe la llamada a Triton?",
            "formula": "R = P − g (lo que le queda a la request) · T_e = min(T, R); si R ≤ 0, 504 sin llamar",
            "c01": {"cuenta": "P = 250, T = 150 · Ana gastó 9 ms · la subida lenta, 206 ms", "valor": "Ana: 150 ms · la lenta: 44 ms"},
            "taller": {"cuenta": "las mismas reglas · una subida de 240 ms", "valor": "4 ms: sale con 504 aunque Triton esté sano"},
            "decide": "Con un tope fijo de 150 ms, la de la subida lenta esperaría hasta los 356 ms, cuando la app ya mostró su selector manual. Con min(T, R) contesta a los 250 ms, a tiempo.",
            "conceptos": ["cadena-plazos"],
            "comprueba": cmd("python -c \"\nP, T = 250, 150\nfor nombre, subir, cpu, decode in [('Ana', 3, 0, 6), ('subida lenta', 200, 0, 6), ('subida de 240 ms', 240, 0, 6)]:\n    g = subir + cpu + decode\n    print(f'{nombre}: gastado {g} ms · queda {P - g} ms · plazo de Triton min({T}, {P - g}) = {min(T, P - g)} ms')\"", L("pc plazo")),
            "confirma": f"el paso 7: con Triton congelado, classify sale con 504 a los {float(T504) * 1000:.0f} ms.",
        },
        {
            "id": "batch", "pregunta": "¿Cuántas fotos junta Triton en cada lote?",
            "formula": "n_b = 1 + λ × v: la primera foto abre una ventana de v segundos y entran las que llegan en ella",
            "c01": {"cuenta": "250/s × 0.002 s en el pico; 500/s con una zona caída", "valor": "1.5 fotos por lote · 2 con una zona caída"},
            "taller": {"cuenta": f"≈ 800/s × 0.002 s, con 8 clientes a la vez", "valor": "≈ 2.6 fotos por lote"},
            "decide": "Con el tráfico de C01, los tamaños preferidos (16 y 32) casi nunca se alcanzan, y está bien: la ventana cuesta solo 2 ms. El lote crece solo cuando hay tráfico para llenarlo.",
            "conceptos": ["batching-dinamico"],
            "comprueba": cmd("python -c \"\nfor nombre, llegan in [('C01, una T4 en el pico (250/s)', 250), ('C01, una zona caída (500/s)', 500), ('dojo, verificar responde (≈ 800/s)', 800)]:\n    print(f'{nombre}: 1 + {llegan} × 0.002 = {1 + llegan * 0.002:.1f} fotos por batch')\"", L("pc batch")),
            "confirma": f"el paso 5: las métricas de Triton dicen {BATCH} fotos por lote en promedio después de <code>verificar.py responde</code>.",
        },
        {
            "id": "tensor", "pregunta": "¿Cuánto pesa lo que el gateway le manda a Triton?",
            "formula": "tensor = canales × alto × ancho × 4 B (FP32), contra los bytes de la foto",
            "c01": {"cuenta": "3 × 224 × 224 × 4 B contra una foto de ≈ 215 KB", "valor": "602 KB: ≈ 2.8 veces la foto"},
            "taller": {"cuenta": "3 × 32 × 32 × 4 B contra la foto de tenis de 1,278 B", "valor": "12 KB: ≈ 9.6 veces la foto"},
            "decide": "Por eso el gateway manda el tensor en binario (la extensión binaria de Triton) y no como una lista de números en JSON, que pesaría varias veces más. Mandar el JPEG y decodificar en Triton ahorraría red, pero pondría trabajo de CPU y bytes hostiles en la máquina cara.",
            "conceptos": ["triton"],
            "comprueba": cmd("python -c \"\nfor nombre, lado, foto in [('C01', 224, 214_836), ('dojo', 32, 1_278)]:\n    t = 3 * lado * lado * 4\n    print(f'{nombre}: tensor 3 × {lado} × {lado} × 4 B = {t:,} B · la foto pesa ≈ {foto:,} B · {t / foto:.1f} veces')\"", L("pc tensor")),
        },
        {
            "id": "log", "pregunta": "¿Cuánto log sale al día?",
            "formula": "bytes al día = requests al día × bytes por línea",
            "c01": {"cuenta": "10 M requests × ≈ 300 B", "valor": "≈ 3 GB al día"},
            "taller": {"cuenta": f"una línea real pesa {LINEA_B} B", "valor": "≈ 0.6 MB por cada 2,000 requests"},
            "decide": "Una línea por request, sin la foto y sin datos de quien vende, cabe de sobra. Con la foto (≈ 215 KB) serían ≈ 2 TB al día, y datos personales en el log.",
            "conceptos": ["log-estructurado"],
            "comprueba": cmd("python -c \"\nfor nombre, por_dia, bytes_ in [('C01', 10_000_000, 300), ('dojo, un día de verificar', 2_000, 300)]:\n    print(f'{nombre}: {por_dia:,} requests × {bytes_} B = {por_dia * bytes_ / 1e9:.3f} GB al día')\"", L("pc log")),
            "confirma": f"el paso 8: la línea de la foto de tenis pesa {LINEA_B} B.",
        },
    ],
}

conceptos = [
    {"id": "gateway", "termino": "Gateway y servidor de modelos", "en": "API gateway / model server",
     "def": "Dos programas con trabajos distintos. El gateway recibe la request, la revisa, prepara la foto en la CPU y contesta. El servidor de modelos solo convierte tensores en tensores en la GPU.",
     "analogia": "El mesero y la cocina: el mesero toma el pedido, revisa que se pueda hacer y lo entrega; la cocina solo cocina, y nunca habla con el cliente.",
     "importa": "Cada uno escala por su lado (gateways baratos en CPU, pocas GPUs caras), y los bytes hostiles de internet nunca llegan al proceso que tiene la GPU.",
     "trampa": "Meter el modelo de PyTorch dentro del gateway «porque es más simple»: cada despliegue recarga el modelo y cada foto corre sola en la GPU."},
    {"id": "triton", "termino": "Triton Inference Server", "en": "NVIDIA Triton",
     "def": "El servidor de modelos de NVIDIA: carga modelos de una carpeta y los atiende por HTTP o gRPC con el protocolo de inferencia v2 de KServe, juntando peticiones en lotes.",
     "analogia": "Una cocina industrial con reglas escritas para cada platillo: qué ingredientes recibe, en qué cantidad y cuántos prepara a la vez.",
     "importa": "El gateway le habla con su cliente oficial (<code>tritonclient</code>) y le manda el tensor en binario. En el dojo, un servidor sustituto con el mismo protocolo deja usar ese mismo cliente.",
     "trampa": "Mandar el tensor como lista de números en JSON: pesa varias veces más y se tarda en convertir."},
    {"id": "model-repository", "termino": "Model repository", "en": "Triton model repository",
     "def": "La carpeta de donde Triton carga los modelos: una subcarpeta por modelo, con su <code>config.pbtxt</code> y una carpeta numerada por versión con el archivo del modelo.",
     "analogia": "El recetario de la cocina: cada platillo con su ficha y la receta de la edición vigente.",
     "importa": "Con <code>--model-control-mode=none</code>, Triton carga lo que hay al arrancar y nada más: qué modelo corre lo dice la carpeta (en C01, la imagen). Por eso se arma desde el registro, con huellas, y nunca a mano.",
     "trampa": "Confundir la versión de la carpeta (1/) con la del registro (v4): la de verdad va en las huellas y en el <code>model_version</code> de cada respuesta."},
    {"id": "config-pbtxt", "termino": "config.pbtxt", "en": "Triton model configuration",
     "def": "La configuración de un modelo en Triton, en el formato de texto de protobuf: el backend, el batch máximo, la entrada y la salida, el batching, las copias y el warmup.",
     "analogia": "La ficha técnica de un aparato: el enchufe, el voltaje y cuántos puede atender a la vez.",
     "importa": "Triton revisa la ficha contra el modelo y no carga si no cuadran. <code>dims</code> va sin el eje del batch cuando <code>max_batch_size</code> > 0: Triton le antepone −1.",
     "trampa": "Poner el batch dentro de <code>dims</code> ([1, 3, 32, 32]): el modelo no carga, y con <code>--exit-on-error</code> Triton ni arranca."},
    {"id": "batching-dinamico", "termino": "Batching dinámico", "en": "dynamic batching",
     "def": "Triton espera un poco (aquí 2 ms) desde que llega una foto a que lleguen otras, y las corre juntas en un solo lote.",
     "analogia": "Un elevador que espera unos segundos con la puerta abierta por si llega alguien más antes de subir.",
     "importa": "Un lote de varias fotos cuesta casi lo mismo que una en la GPU: más fotos por segundo con la misma máquina. La espera es corta para que no se note en la latencia.",
     "trampa": "Una ventana larga para «llenar» lotes con poco tráfico: cada foto espera y nadie gana."},
    {"id": "politica-fila", "termino": "Política de la fila", "en": "queue policy",
     "def": "Lo que Triton hace con una foto que esperó demasiado en su fila sin entrar al modelo: con <code>REJECT</code>, la saca y contesta error (aquí, a los 100 ms).",
     "analogia": "Un restaurante que, en vez de dejar crecer la fila de la puerta, le avisa al que lleva mucho esperando que mejor vaya a otro lado.",
     "importa": "Una foto que ya esperó 100 ms llegaría tarde de todas formas: correrla gasta GPU en una respuesta que nadie va a ver. Bajo sobrecarga, mejor errores rápidos que una fila que hace lentas a todas.",
     "trampa": "Una fila sin tope: bajo carga crece sin límite y todas las respuestas llegan tarde."},
    {"id": "instancias-warmup", "termino": "Copias del modelo y warmup", "en": "instance group / model warmup",
     "def": "<code>instance_group</code> carga varias copias del modelo para atender lotes en paralelo. <code>model_warmup</code> corre el modelo con datos de relleno antes de decir «listo».",
     "analogia": "Dos cocineros en la misma estufa, y prender los quemadores antes de abrir: la primera orden no paga el precalentado.",
     "importa": "Mientras una copia corre un lote, la otra recibe el siguiente. Y las primeras corridas pagan una preparación que no se repite: mejor antes de atender que en la foto de un cliente.",
     "trampa": "Decir «listo» antes del warmup: las primeras requests después de cada despliegue salen lentas."},
    {"id": "uvicorn-asgi", "termino": "uvicorn, ASGI y FastAPI", "en": "ASGI server / framework",
     "def": "uvicorn es el servidor que abre el puerto y corre el event loop; ASGI es el contrato entre servidor y aplicación; FastAPI es el armazón donde escribes tus rutas.",
     "analogia": "El local, el reglamento de la cocina y la carta: cada uno cambia sin tocar a los otros.",
     "importa": "Con <code>--workers 1</code>, la concurrencia sale del event loop y del threadpool; la capacidad, de más copias. Cada flag de uvicorn es una decisión (keep-alive, apagado ordenado, sin log de acceso).",
     "trampa": "Hacer trabajo de CPU (decodificar) directo en la ruta async: congela el event loop y nadie más avanza."},
    {"id": "lifespan", "termino": "Lifespan", "en": "lifespan events",
     "def": "La función que corre una vez al arrancar, antes de la primera request, y una vez al apagarse.",
     "analogia": "Abrir el local: revisar que la cocina tenga gas y que el menú corresponda antes de dejar pasar al primer cliente.",
     "importa": "Ahí se crea UN cliente de Triton para todo el proceso y se revisa lo que no puede fallar: que los labels sean los del modelo y que Triton sirva la forma esperada. Si algo no cuadra, el proceso no arranca.",
     "trampa": "Crear un cliente nuevo por request: cada foto abre su conexión y el pool no sirve."},
    {"id": "vivo-listo", "termino": "Vivo y listo", "en": "liveness / readiness",
     "def": "<code>/healthz</code> contesta «sigo vivo» sin preguntarle a nadie. <code>/readyz</code> contesta «mándame tráfico» solo si Triton dice que el modelo está listo, con un tope de tiempo.",
     "analogia": "«¿Respiras?» contra «¿puedes atender?»: un mesero con la cocina cerrada respira, pero no debe tomar pedidos.",
     "importa": "Si /healthz falla, Kubernetes reinicia la copia; si /readyz falla, la saca del reparto sin reiniciarla. Si /healthz preguntara por Triton, una caída de Triton reiniciaría a todos los gateways y no arreglaría nada.",
     "trampa": "Un /readyz sin tope: con Triton trabado, la pregunta misma se queda colgada."},
    {"id": "embudo", "termino": "Revisar de lo barato a lo caro", "en": "input validation order",
     "def": "Las revisiones de cada foto van ordenadas por costo: el tipo (comparar un texto), el tamaño anunciado (un header), el tamaño real (leer), los píxeles (el encabezado), la forma y al final el decode.",
     "analogia": "En la puerta de un concierto se revisa el boleto antes que la bolsa, y la bolsa antes que el detector de metales.",
     "importa": "Una foto que falla lo barato no gasta nada en lo caro, y cada rechazo lleva su código: 415, 413 o 400. La defensa contra una bomba de descompresión (un PNG de 48 MP en negro pesa ≈ 140 KB y decodificado ocupa cientos de MB) es leer el ancho y el alto del encabezado con <code>Image.open</code>, sin decodificar, y rechazar por píxeles; <code>MAX_IMAGE_PIXELS</code> de Pillow queda de respaldo.",
     "trampa": "Confiar en <code>Content-Length</code> (puede mentir o no venir: el corte de verdad es al leer, en pedazos), o revisar solo los bytes y creer que con eso basta."},
    {"id": "semaforo", "termino": "Semáforo y threadpool", "en": "semaphore / threadpool",
     "def": "El decode corre en un hilo aparte (<code>run_in_threadpool</code>) para no congelar el event loop, y un semáforo de 2 lugares deja decodificar a solo dos a la vez.",
     "analogia": "Un probador con dos cabinas: los demás esperan afuera, y si esperan demasiado, se les dice que vuelvan luego.",
     "importa": "Un decode de 40 MP ocupa ≈ 320 MB: con los 40 hilos que trae el threadpool por omisión, serían ≈ 13 GB. Quien espera más de 50 ms un lugar recibe 503 con <code>Retry-After</code>.",
     "trampa": "Una fila de CPU sin tope: solo produce respuestas que llegan cuando la app ya se rindió."},
    {"id": "en-vuelo", "termino": "Tope de requests en vuelo", "en": "max in-flight requests / load shedding",
     "def": "Cuántas requests puede tener adentro una copia a la vez. La que llega con el tope lleno recibe 503 al instante, sin leer su body.",
     "analogia": "El cupo de un salón: el que llega con el salón lleno no entra, y se le dice en la puerta, no después de sentarlo.",
     "importa": "Rechazar cuesta microsegundos y protege la memoria y la latencia de las que ya están adentro. El número sale de la Ley de Little, recortado por la memoria del peor momento.",
     "trampa": "Subir el tope porque «la CPU está al 40 %»: el tope cuida la memoria del peor caso, no la CPU de hoy."},
    {"id": "cadena-plazos", "termino": "La cadena de plazos", "en": "deadline propagation",
     "def": "Cada eslabón espera menos que el de afuera: la app 300 ms, el gateway 250, la llamada a Triton 150 (o lo que le quede a la request, si es menos) y la fila de Triton 100.",
     "analogia": "Muñecas rusas de tiempo: la de adentro siempre cabe en la de afuera, así que se rinde primero y la de afuera todavía alcanza a avisar.",
     "importa": "Así cada falla se contesta a tiempo con su código, en vez de que la app se rinda sin saber qué pasó. El plazo se corta con <code>asyncio.wait_for</code>: el <code>timeout</code> de <code>infer()</code> es otra cosa (un tiempo para la fila del servidor).",
     "trampa": "Estirar el plazo de Triton por encima del de la request «porque a veces tarda»: la app se rinde primero y el gateway sigue esperando."},
    {"id": "codigos-http", "termino": "El código de cada falla", "en": "HTTP status codes",
     "def": "Los 4xx son culpa de quien llama (400, 405, 413, 415, 422) y no cuentan contra la promesa de servicio; los 5xx son del sistema (500, 503, 504). El 499, de nginx, es «quien llama se fue».",
     "analogia": "En una paquetería: «tu caja venía rota» no es lo mismo que «se nos descompuso el camión».",
     "importa": "Las alertas y el SLO cuentan los 5xx. Un 422 o un 499 mal clasificados como 5xx despiertan a alguien a las 3 de la mañana por un cliente que mandó mal los datos.",
     "trampa": "Contestar 200 con un error adentro del JSON: nadie lo cuenta."},
    {"id": "softmax-estable", "termino": "Softmax estable y la guardia", "en": "numerically stable softmax",
     "def": "Antes de sacar la exponencial, a todos los logits se les resta el más grande: el resultado es el mismo y ninguna exponencial se desborda. Y si algún logit no es finito (NaN o infinito), 500.",
     "analogia": "Medir alturas desde la azotea en lugar de desde el centro de la Tierra: las diferencias son las mismas y los números caben en la regla.",
     "importa": "Un engine roto puede dar NaN. Sin la guardia, el error salta al convertir la respuesta en JSON, después de escribir el log: el log diría 200 y la app vería un 500.",
     "trampa": "Contestar 200 con probabilidades de basura."},
    {"id": "log-estructurado", "termino": "Una línea de log por request", "en": "structured logging",
     "def": "Al final de cada request, pase lo que pase (un <code>finally</code>), una línea de JSON con campos fijos: request_id, quién llamó, versión del modelo, top-5, milisegundos de cada paso, tamaño, huella y código.",
     "analogia": "El ticket de cada venta: siempre con los mismos campos, para poder sumarlos sin leerlos uno por uno.",
     "importa": "Una máquina la filtra y la cuenta: de ahí sale el diagnóstico (¿dónde se fue el tiempo?) y, con el request_id, la unión con la publicación que la estación 1 convierte en etiquetas. Junto al log van las métricas de <code>/metrics</code> (requests por código, latencias, score top-1), con nombres fijos: las alertas las buscan por nombre, y los 4xx no entran al histograma de latencia porque un 415 tarda microsegundos.",
     "trampa": "Meter la foto o datos de quien vende en el log (pesa terabytes y son datos personales), o renombrar una métrica y apagar una alerta sin que nadie se entere."},
    {"id": "triton-falso", "termino": "Pruebas con un Triton falso", "en": "test double / mock",
     "def": "Un objeto con los mismos métodos asíncronos que el cliente de Triton y las mismas excepciones, que contesta lo que la prueba le pida: logits, una demora, un error o «no listo».",
     "analogia": "Un simulador de vuelo: se practica la falla de motor sin estrellar un avión.",
     "importa": "Las pruebas corren en segundos en cualquier máquina, sin GPU, y cubren las fallas que en producción no se pueden provocar a voluntad. Además revisan el nombre, el tipo y la forma del tensor que saldría hacia Triton.",
     "trampa": "Un falso que acepta cualquier cosa: un cambio que mande los canales al final ([1, 32, 32, 3]) pasaría las pruebas y fallaría en producción."},
]
e["conceptos"] = conceptos

e["mundo"] = {
    "resumen": "El kit trae el marketplace de C01 el 1 de octubre de 2026, a las 09:00 UTC: el gate aprobó a <code>classifier</code> v4 y la estación 5 le construyó su engine. En MLflow están v1 a v4, y v3 y v4 con <code>engine=listo</code> y sus huellas; <code>servir.yaml</code> dice qué se sirve (v4, por número). El mundo trae además un servidor de modelos con el mismo protocolo que Triton, las reglas del gateway y fotos buenas y malas para probar. Tú escribes lo que pone a v4 a atender.",
    "trae": [
        {"que": "El S3 local y MLflow (compose.yaml)", "detalle": "RustFS en el puerto 9700 (el examen y los checkpoints) y MLflow en el 5700, con su interfaz."},
        {"que": "mundo/crear.py", "detalle": f"Crea todo en ≈ {round(int(CREAR_S) / 60)} minutos: baja Fashion-MNIST, congela <code>golden-v1</code>, entrena <code>classifier</code> v1 a v4 con la receta de la estación 3, construye los engines de v3 y v4 con la receta de la estación 5, y deja <code>servir.yaml</code> y <code>fotos-raras/</code>."},
        {"que": "mundo/triton_dojo/", "detalle": "El servidor de modelos del dojo, el sustituto de Triton: lee tu <code>config.pbtxt</code> (y se niega a cargar si no cuadra con el engine), hace batching dinámico con su fila y su plazo, carga copias con warmup y habla el protocolo HTTP de Triton, con la extensión binaria y sus métricas <code>nv_inference_*</code>."},
        {"que": "mundo/servicios.py", "detalle": "Arranca, para, reinicia y revisa los dos procesos (Triton en el 8700 y tu gateway en el 8701), con su log en <code>logs/</code>: lo que en C01 hace Kubernetes."},
        {"que": "gateway.yaml y mundo/revisiones.json", "detalle": "Las reglas del gateway (tipos, límites, cadena de plazos, Triton), y el registro de sus versiones revisadas: el sustituto del historial de PR."},
        {"que": "gateway/app/preprocess.py", "detalle": "El preprocess compartido con el entrenamiento, tal cual. Tu gateway lo importa: nunca lo reescribe."},
        {"que": "mundo/modelos.py", "detalle": "Mirar y reparar el registro: versiones, el engine de cada una, alias y su <code>labels.json</code>."},
        {"que": "verificar.py y romper.py", "detalle": "12 checks con los criterios de «listo» y 6 fallas en el mundo, la configuración o la infraestructura, nunca en lo que escribes."},
    ],
    "tu_pipeline": [
        {"archivo": "servir/armar.py", "hace": "El model repository y la ficha del modelo (<code>servir/modelo.json</code>) desde el registro: la versión por número, el engine y los labels solo si sus huellas son las del registro."},
        {"archivo": "model_repository/classifier/config.pbtxt", "hace": "Cómo carga y atiende Triton el modelo: backend, batch, entrada y salida, batching dinámico, fila con plazo, dos copias y warmup."},
        {"archivo": "gateway/app/revision.py", "hace": "La revisión de cada foto, de lo barato a lo caro, con el código de cada rechazo."},
        {"archivo": "gateway/app/main.py", "hace": "El gateway: lifespan, salud, métricas y classify con sus topes, su plazo, el código de cada falla y una línea de log por request."},
        {"archivo": "gateway/tests/", "hace": f"El Triton falso y las pruebas de la tabla de códigos, los topes, la salud y el log ({PRUEBAS} en la solución)."},
    ],
    "requisitos": [
        "Docker Desktop corriendo, con ≈ 700 MB libres para las imágenes de RustFS y MLflow",
        "Python 3.11 o más nuevo (se probó con 3.14.3) y ≈ 1.2 GB para el entorno virtual (PyTorch solo para crear el mundo)",
        "git (con tu nombre y correo configurados) y curl",
        "Internet la primera vez (los paquetes, las imágenes y Fashion-MNIST)",
        "Los puertos 9700, 9701, 5700, 8700 y 8701 libres en tu Mac",
    ],
    "sustituciones": [
        {"nube": "Triton con TensorRT en una T4 (<code>tensorrt_plan</code>, <code>KIND_GPU</code>)", "local": "el servidor del dojo con ONNX Runtime en tu CPU (<code>onnxruntime_onnx</code>, <code>KIND_CPU</code>)", "diferencia": "Lee el mismo formato de <code>config.pbtxt</code>, se niega a cargar igual que Triton cuando no cuadra, y habla el mismo protocolo HTTP: el gateway usa el cliente oficial <code>tritonclient</code> sin cambiar nada. Solo trae ese backend, solo HTTP y solo los campos que usa la estación."},
        {"nube": "Pods en Kubernetes: 3 a 12 gateways y un Triton por zona", "local": "dos procesos en tu Mac (<code>mundo/servicios.py</code>)", "diferencia": "Kubernetes arranca, vigila /healthz y /readyz, y reinicia o saca del reparto. Aquí lo haces tú con <code>servicios.py</code> y lo ves con <code>estado</code>."},
        {"nube": "El ConfigMap <code>classifier-labels-14</code> con <code>labels.json</code>", "local": "<code>servir/modelo.json</code>, que arma <code>servir/armar.py</code>", "diferencia": "Los dos traen las categorías de la versión con su huella; el gateway la revisa al arrancar."},
        {"nube": "El token que verificó el ALB (<code>client_id</code>)", "local": "el header <code>X-Caller-Id</code>", "diferencia": "En C01 quien llama no lo puede falsificar; aquí es solo un header, para que el log tenga un <code>caller</code>."},
        {"nube": "El model repository dentro de la imagen de Triton", "local": "la carpeta <code>model_repository/</code> de tu kit", "diferencia": "En C01 nadie puede cambiarla con el servidor andando: cambiar de modelo es cambiar de imagen. Aquí es una carpeta, y por eso una de las fallas es justo cambiarla a mano."},
        {"nube": "El historial de PR del repositorio <code>classifier</code>", "local": "<code>mundo/revisiones.json</code>", "diferencia": "Las reglas revisadas se comprueban por su huella."},
    ],
    "arranque": "unzip c01-serving.zip && cd c01-serving\npython3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt\ndocker compose up -d --wait\npython mundo/crear.py\ngit init && git add -A && git commit -m \"kit recién descomprimido\"\npython verificar.py mundo",
    "python": "python",
}

G = []
G.append(dict(n=0, id="mundo", titulo="Levantar el mundo", objetivo="El S3 local y MLflow arriba, el mundo creado y la carpeta como repositorio de git.",
    conceptos=["gateway"],
    explica="El mundo vive en dos servicios: el S3 local (el examen y los checkpoints) y MLflow (el registro de modelos). <code>mundo/crear.py</code> los llena igual cada vez: entrena los cuatro modelos del registro y construye los engines de v3 y v4, por eso tarda unos minutos. El servidor de modelos y tu gateway no van en Docker: son procesos de tu Mac que arrancas desde el paso 3.",
    codigo=[],
    comandos=[
        cmd("python3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt", L("p0 venv"), "Tarda unos minutos la primera vez (PyTorch pesa ≈ 1 GB; solo lo usa <code>mundo/crear.py</code>). Desde aquí, cada terminal nueva necesita <code>source .venv/bin/activate</code>."),
        cmd("docker compose up -d --wait\npython mundo/crear.py", L("p0 up") + "\n" + L("p0 crear", quitar=r"^(real|user|sys) "), "La interfaz de MLflow queda en http://localhost:5700."),
        cmd("git init && git add -A && git commit -m \"kit recién descomprimido\"\ngit log --oneline", L("p0 git"), "Los ids de commit cambian en cada máquina."),
        cmd(f"{V} mundo", L("p0 verificar")),
    ],
    verifica="<code>verificar.py mundo</code> en verde: los buckets, el examen, <code>classifier</code> v1–v4 con v4 en <code>engine=listo</code>, <code>servir.yaml</code>, <code>fotos-raras/</code> y git.",
    ojo="Los puertos de esta estación (9700, 5700, 8700 y 8701) no chocan con los de las anteriores: puedes tener varias estaciones arriba a la vez."))

G.append(dict(n=1, id="reglas", titulo="Qué se sirve y con qué reglas", objetivo="Saber, antes de escribir código, qué versión se sirve, qué engine y con qué reglas atiende el gateway.",
    conceptos=["gateway", "triton", "cadena-plazos"],
    explica="<code>servir.yaml</code> dice qué se sirve, por número: v4, con el nombre que verá quien llama. El registro dice que v4 pasó el gate y tiene su engine, con su huella y la versión de ONNX Runtime con que se construyó. <code>gateway.yaml</code> trae las reglas del equipo de serving: qué tipos de foto se aceptan, los límites (bytes, píxeles, proporción), los topes (decodes y requests en vuelo) y la cadena de plazos. Tu código las lee; nunca las escribe.",
    codigo=[{"lang": "yaml", "path": "gateway.yaml", "code": (APP / "kits/c01-serving/gateway.yaml").read_text().rstrip(), "nota": "Del equipo de serving. Sus versiones revisadas están en <code>mundo/revisiones.json</code>."}],
    comandos=[
        cmd("grep -v \"^#\" servir.yaml", L("p1 servir")),
        cmd("python mundo/modelos.py versiones", L("p1 versiones"), "v3 (<code>@champion</code>) y v4 (<code>@challenger</code>) tienen <code>engine=listo</code>: los dos se pueden servir. Esta noche se arma v4; quién recibe tráfico lo decide el rollout (estación 10)."),
        cmd("python mundo/modelos.py engine 4", L("p1 engine")),
        cmd(f"{V} reglas", L("p1 verificar")),
    ],
    verifica="Puedes decir en voz alta: sirvo <code>classifier</code> v4 como <code>miniresnet-2026-10-01</code>; acepto JPEG, PNG y WebP de hasta 10 MiB y 40 MP; 2 decodes y 16 requests a la vez; plazos 300 > 250 > 150 > 100 ms.",
    ojo="El check <code>reglas</code> hace la cuenta de memoria del peor momento con los números de <code>gateway.yaml</code>: es el precálculo «memoria» hecho código."))

G.append(dict(n=2, id="repositorio", titulo="Armar el model repository", objetivo="model_repository/classifier/1/model.onnx es la copia exacta del engine aprobado, y servir/modelo.json trae su versión, sus labels y sus huellas.",
    conceptos=["model-repository"],
    explica="<code>armar.py</code> no copia «el último engine»: lee la versión de <code>servir.yaml</code>, exige <code>gate=passed</code> y <code>engine=listo</code>, baja el engine y el <code>labels.json</code> de la corrida y solo los usa si su sha256 es el del tag de la versión. Revisa que el engine se haya construido con el runtime del servidor. Lee del engine el nombre y la forma de la entrada y la salida, y deja la ficha para el gateway. El <code>config.pbtxt</code> no lo escribe: es tuyo, y va en git.",
    codigo=[{"lang": "python", "path": "servir/armar.py", "code": code("servir/armar.py"), "nota": "El engine (binario, sale del registro) no va en git: <code>.gitignore</code> ignora <code>model_repository/*/1/</code>. El <code>config.pbtxt</code> sí."}],
    comandos=[
        cmd("python servir/armar.py", L("p2 armar")),
        cmd("python servir/armar.py", L("p2 otra vez"), "Otra vez: no cambia nada."),
        cmd("find model_repository servir -type f | sort\npython -m json.tool servir/modelo.json | head -12", L("p2 arbol"), "El <code>config.pbtxt</code> todavía es el esqueleto: lo escribes en el paso 3."),
        cmd(f"{V} repositorio", L("p2 verificar")),
    ],
    verifica="<code>model_repository/classifier/1/model.onnx</code> con la huella del tag <code>engine_sha256</code> de v4, y <code>servir/modelo.json</code> con <code>miniresnet-2026-10-01</code>, los 10 labels en su orden y sus huellas.",
    ojo="La carpeta <code>1/</code> es la versión dentro de Triton, no la del registro: la de verdad va en la ficha y en cada respuesta (<code>model_version</code>)."))

G.append(dict(n=3, id="config", titulo="El config.pbtxt y Triton", objetivo="Triton carga classifier con tu config.pbtxt: batching dinámico, fila con plazo, dos copias y warmup, y dice «listo».",
    conceptos=["config-pbtxt", "batching-dinamico", "politica-fila", "instancias-warmup", "triton"],
    explica="El <code>config.pbtxt</code> le dice a Triton cómo atender el modelo. <code>dims</code> va sin el eje del batch (Triton le antepone −1). <code>dynamic_batching</code> espera hasta 2 ms a que lleguen más fotos y rechaza (<code>REJECT</code>) la que lleve 100 ms en la fila: el último eslabón de la cadena de plazos. <code>instance_group</code> carga dos copias y <code>model_warmup</code> las corre con ceros antes de decir «listo». Triton arranca con flags explícitos: carga solo al arrancar, no rellena lo que falta del config, y si un modelo no carga, termina.",
    codigo=[{"lang": "text", "path": "model_repository/classifier/config.pbtxt", "code": code("model_repository/classifier/config.pbtxt"), "nota": "En C01: <code>platform: \"tensorrt_plan\"</code>, [3, 224, 224] → [500] y <code>KIND_GPU</code>."}],
    comandos=[
        cmd("# a propósito: el batch dentro de dims, como [1, 3, 32, 32]\npython mundo/servicios.py arrancar triton", L("p3 mal"), "Triton revisa la ficha contra el engine y no carga; con <code>--exit-on-error=true</code>, ni arranca. Mejor así que un servidor prendido sin modelo. (Después se regresa el archivo bueno.)"),
        cmd("python mundo/servicios.py arrancar triton", L("p3 arrancar")),
        cmd("cat logs/triton.log", L("p3 log"), "La huella del engine que cargó queda en el log: es lo que revisa el check <code>triton</code>."),
        cmd("curl -s localhost:8700/v2/models/classifier\ncurl -s -o /dev/null -w \"/v2/health/ready → %{http_code}\\n\" localhost:8700/v2/health/ready", L("p3 meta")),
        cmd(f"{V} config triton", L("p3 verificar")),
    ],
    verifica="Triton (el del dojo) en el puerto 8700, listo, con <code>classifier</code> cargado desde el engine aprobado: entrada <code>[-1, 3, 32, 32]</code>, salida <code>[-1, 10]</code>, y la configuración que sirve es la de tu disco.",
    ojo="Triton carga solo al arrancar (<code>--model-control-mode=none</code>): si cambias el <code>config.pbtxt</code> o el engine, <code>python mundo/servicios.py reiniciar triton</code>. El check <code>triton</code> avisa si corre con otra configuración que la de disco."))

G.append(dict(n=4, id="revision", titulo="Revisar cada foto, de lo barato a lo caro", objetivo="revision.py rechaza cada foto mala con su código antes de gastar en ella, y prepara las buenas con el preprocess compartido.",
    conceptos=["embudo"],
    explica="Siete revisiones, en orden de costo: el tipo (415), el <code>Content-Length</code> (413 sin leer el body), el tamaño real al leer en pedazos (413), el body vacío (400), los píxeles leídos del encabezado (413, sin decodificar), la proporción (400) y al final el decode (400 si está corrupta o cortada). Lo bueno pasa por <code>preprocess.py</code>, el mismo del entrenamiento: endereza por EXIF, convierte a RGB, redimensiona, recorta y normaliza.",
    codigo=[{"lang": "python", "path": "gateway/app/revision.py", "code": code("gateway/app/revision.py"), "nota": "<code>Image.open</code> lee solo el encabezado: por eso el PNG de 48 MP se rechaza sin gastar los cientos de MB de su decode."}],
    comandos=[
        cmd("python -c \"…revisa cada foto de fotos-raras/ con revision.py…\"", L("p4 revisar"), "Sin servidor todavía: solo las funciones. La foto girada da el mismo tensor de [3, 32, 32] porque el preprocess la endereza."),
    ],
    verifica="Las fotos buenas salen como tensor [3, 32, 32]; el PDF da 415, el PNG de 48 MP 413, y la vacía, la tira, la corrupta y la cortada 400.",
    ojo="El paso de bytes al leer existe porque el header puede mentir o no venir: lo prueba el check <code>rechazos</code> mandando 11 MiB sin <code>Content-Length</code>."))

G.append(dict(n=5, id="classify", titulo="El gateway: arranque, salud y classify", objetivo="El gateway arranca solo si todo cuadra, contesta /healthz y /readyz, y classify responde lo mismo que el engine aprobado.",
    conceptos=["uvicorn-asgi", "lifespan", "vivo-listo", "softmax-estable", "triton"],
    explica="<code>crear_app()</code> lee las reglas y revisa la cadena de plazos. El lifespan lee la ficha (y la huella de sus labels), crea UN cliente de Triton con su pool de conexiones, le pide la metadata del modelo y revisa que la entrada, la salida y el número de logits sean los de la ficha: si no, no arranca. <code>classify</code> revisa, decodifica en un hilo con el semáforo, llama a Triton con plazo y el tensor en binario, aplica el softmax estable con su guardia y contesta con <code>model_version</code>, las predicciones y <code>X-Request-ID</code>.",
    codigo=[{"lang": "python", "path": "gateway/app/main.py", "code": code("gateway/app/main.py"), "nota": "<code>crear_app(triton=…, reglas=…, modelo=…)</code> existe para las pruebas: les deja pasar un Triton falso."}],
    comandos=[
        cmd("python mundo/servicios.py arrancar gateway", L("p5 arrancar")),
        cmd("python mundo/servicios.py estado", L("p5 estado")),
        cmd("curl -s -i -X POST \"localhost:8701/v1/classify?top_k=3\" \\\n  -H \"Content-Type: image/jpeg\" -H \"X-Request-ID: ana-0001\" -H \"X-Client-Source: mobile\" \\\n  --data-binary @fotos-raras/tenis.jpg", L("p5 classify")),
        cmd("curl -s localhost:8701/healthz\ncurl -s localhost:8701/readyz", L("p5 salud")),
        cmd(f"{V} salud responde", L("p5 verificar"), "<code>responde</code> manda 200 fotos del examen por HTTP y compara cada top-1 con el engine aprobado corrido aquí mismo."),
        cmd("curl -s localhost:8700/metrics | grep -E \"^nv_inference_(count|exec_count)\"", L("p5 batch"), "Las métricas de Triton: cuántas fotos y en cuántos lotes. Es el precálculo «batch» medido."),
        cmd("ps -o rss= -p $(cat logs/gateway.pid)", L("p5 memoria")),
    ],
    verifica=f"<code>/healthz</code> y <code>/readyz</code> en 200, las 6 métricas en <code>/metrics</code>, y 200 fotos del examen por HTTP con el mismo top-1 que el engine aprobado (≈ {FOTOS_S} fotos/s con 8 a la vez).",
    ojo="La primera foto de cada formato tarda más (Pillow carga su decodificador la primera vez): por eso C01 calienta también el gateway antes de decir «listo»."))

G.append(dict(n=6, id="codigos", titulo="El código de cada falla y los topes", objetivo="Cada foto mala sale con su código, la 17 en vuelo recibe 503 al instante, y cada falla de Triton tiene su respuesta.",
    conceptos=["codigos-http", "semaforo", "en-vuelo"],
    explica="Con el gateway arriba, la tabla de códigos se prueba de verdad: cada foto rara con su código, el 422 de <code>top_k</code> fuera de rango (que FastAPI decide antes de <code>classify</code>, por eso lleva su propio manejador para dejar log), el 405 y el 499 de quien se va a media subida. Los topes y las fallas de Triton (lento, con error, caído, NaN) no se pueden provocar a voluntad con el servidor real: el check <code>topes</code> corre tu gateway dentro de su proceso con un Triton falso.",
    codigo=[],
    comandos=[
        cmd("for f in \"tenis.png image/png\" \"documento.pdf application/pdf\" …; do\n  curl -s -X POST localhost:8701/v1/classify -H \"Content-Type: $2\" --data-binary @fotos-raras/$1\ndone", L("p6 codigos")),
        cmd(f"{V} rechazos topes", L("p6 verificar")),
    ],
    verifica="200 en JPEG, PNG, WebP y la girada; 415, 413 (header, al leer y por píxeles), 400, 422, 405 y 499 en el log; la 17 en vuelo con 503 y <code>Retry-After: 1</code>; Triton lento 504, con error 503, caído 503 con <code>Retry-After</code>, NaN 500.",
    ojo="Sin reintentos: con Triton sobrecargado, un segundo intento suma trabajo justo cuando ya sobra. La app tiene su plan B (el selector manual)."))

G.append(dict(n=7, id="plazos", titulo="Los plazos, con Triton congelado", objetivo="Con Triton congelado de verdad, classify sale con 504 a los ≈ 150 ms, /readyz con 503 y /healthz sigue en 200.",
    conceptos=["cadena-plazos", "vivo-listo"],
    explica="<code>kill -STOP</code> congela el proceso de Triton: acepta conexiones pero no contesta, como una GPU trabada. El gateway corta la llamada con <code>asyncio.wait_for</code> a los 150 ms (o a lo que le quede a la request) y contesta 504; <code>/readyz</code> pregunta con su propio tope y dice 503 (Kubernetes sacaría esta copia del reparto); <code>/healthz</code> no le pregunta a nadie y sigue en 200 (reiniciar el gateway no arreglaría a Triton).",
    codigo=[],
    comandos=[
        cmd("kill -STOP $(cat logs/triton.pid)\ncurl -s -o /dev/null -w \"classify → %{http_code} en %{time_total} s\\n\" -X POST localhost:8701/v1/classify \\\n  -H \"Content-Type: image/jpeg\" --data-binary @fotos-raras/tenis.jpg\ncurl -s localhost:8701/readyz\ncurl -s localhost:8701/healthz\npython mundo/servicios.py estado\nkill -CONT $(cat logs/triton.pid)", L("p7 congelado"), "<code>ps</code> dice <code>T</code>: el proceso está detenido por una señal. <code>kill -CONT</code> lo despierta."),
        cmd("grep '\"status\": 504' logs/gateway.log | tail -1", L("p7 log"), "<code>ms.triton</code> dice dónde se fue el tiempo."),
        cmd(f"{V} plazos", L("p7 verificar")),
    ],
    verifica=f"504 a los ≈ {float(T504) * 1000:.0f} ms, <code>/readyz</code> 503 dentro de su medio segundo, <code>/healthz</code> 200, y al despertar a Triton todo vuelve a 200.",
    ojo="El parámetro <code>timeout</code> de <code>infer()</code> no es un plazo del cliente: es un tiempo que se le pide a la fila de Triton. Con una red cortada, solo <code>asyncio.wait_for</code> corta a tiempo."))

G.append(dict(n=8, id="log", titulo="El log, las métricas y las pruebas", objetivo="Una línea de JSON por request (también el 422 y el 499), las métricas con sus nombres y sin los 4xx en la latencia, y las pruebas en verde sin Triton.",
    conceptos=["log-estructurado", "triton-falso"],
    explica="La línea de log se escribe en un <code>finally</code>: sale pase lo que pase, con el mismo request_id de la respuesta. Las métricas viven en un registro por app. Las pruebas usan un Triton falso con los mismos métodos y excepciones que el real, que además revisa el nombre, el tipo y la forma del tensor; cubren cada fila de la tabla de códigos, los topes, el plazo, la salud y el log.",
    codigo=[{"lang": "python", "path": "gateway/tests/conftest.py", "code": code("gateway/tests/conftest.py"), "nota": "El PNG que «mide» 8,000 × 6,000 y pesa ≈ 60 B prueba el 413 por píxeles sin gastar memoria."},
            {"lang": "python", "path": "gateway/tests/test_gateway.py", "code": code("gateway/tests/test_gateway.py"), "nota": "La del 499 llama a la aplicación ASGI directamente: el cliente de pruebas siempre entrega el body completo y no sabe cortar una subida."}],
    comandos=[
        cmd("grep '\"request_id\": \"ana-0001\"' logs/gateway.log | python -m json.tool", L("p8 linea")),
        cmd("curl -s localhost:8701/metrics | grep -E \"^classifier_requests_total|^classifier_request_seconds_(count|sum)\"", L("p8 metricas"), "Los 4xx cuentan en <code>classifier_requests_total</code> pero no en la latencia."),
        cmd("python -m pytest -q", L("p8 pytest", quitar=r"^(user|sys) ")),
        cmd(f"{V} log pruebas", L("p8 verificar")),
        cmd(V, L("final", filtro=r"en verde")),
    ],
    verifica=f"Una línea de {LINEA_B} B por request, sin la foto; las métricas con sus nombres; {PRUEBAS} pruebas en ≈ {round(float(PYTEST_S))} s sin Triton; los 12 checks en verde.",
    ojo="De esta línea de log sale lo que la estación 1 convierte en etiquetas, y lo que mira el monitoreo (estación 12): el request_id es la llave de unión."))

REPARTO = {
    1: (["gateway", "triton"], []),
    2: (["model-repository"], []),
    3: (["config-pbtxt", "batching-dinamico", "politica-fila", "instancias-warmup"], []),
    4: (["embudo"], []),
    5: (["uvicorn-asgi", "lifespan", "vivo-listo", "softmax-estable"], ["batch", "tensor"]),
    6: (["codigos-http", "semaforo", "en-vuelo"], ["memoria", "little"]),
    7: (["cadena-plazos"], ["plazo"]),
    8: (["log-estructurado", "triton-falso"], ["log"]),
}
for g in G:
    if g["n"] in REPARTO:
        c, p = REPARTO[g["n"]]
        g["en_pagina"] = {"conceptos": c, "precalculos": p}
e["guiado"] = G

e["solo"] = {
    "reglas": [
        "Empieza con <code>python mundo/reiniciar.py --serving</code> y haz commit del esqueleto.",
        "Sin <code>GUION.md</code>: solo estos objetivos y el contrato arriba de cada archivo.",
        "Cada objetivo tiene su check; corre <code>python verificar.py &lt;check&gt;</code> cuando creas que quedó.",
        "Las reglas no se tocan: <code>gateway.yaml</code>, <code>servir.yaml</code>, <code>gateway/app/preprocess.py</code> y <code>mundo/</code> se quedan como vienen.",
    ],
    "objetivos": [
        {"n": 1, "objetivo": "El S3 local y MLflow arriba, el mundo creado y la carpeta en git.", "check": "mundo"},
        {"n": 2, "objetivo": "Trabajas con las reglas revisadas del gateway, en un commit y sin cambios pendientes.", "check": "reglas"},
        {"n": 3, "objetivo": "El model repository tiene la copia exacta del engine aprobado de la versión de servir.yaml, y la ficha del modelo trae su versión, sus labels y sus huellas.", "check": "repositorio", "pista": "¿Contra qué compruebas que el archivo que bajaste es el que se aprobó?"},
        {"n": 4, "objetivo": "El config.pbtxt cuadra con el engine y trae batching dinámico, una fila que rechaza a tiempo, dos copias y warmup; está en git.", "check": "config", "pista": "¿Las dims llevan el eje del batch?"},
        {"n": 5, "objetivo": "Triton corre, dice «listo» y cargó el engine aprobado con la configuración de tu disco.", "check": "triton"},
        {"n": 6, "objetivo": "El gateway contesta /healthz sin preguntarle a nadie, /readyz según Triton, y /metrics con sus nombres.", "check": "salud"},
        {"n": 7, "objetivo": "Las fotos del examen por HTTP dan el mismo top-1 que el engine aprobado, con model_version y X-Request-ID.", "check": "responde"},
        {"n": 8, "objetivo": "Cada foto mala sale con su código, incluidos el 413 sin Content-Length, el 422, el 405 y el 499 en el log.", "check": "rechazos", "pista": "¿Qué pasa si el header no dice el tamaño, o miente?"},
        {"n": 9, "objetivo": "La 17 en vuelo recibe 503 al instante; Triton lento, con error, caído o con NaN tiene su código; /readyz no espera de más.", "check": "topes"},
        {"n": 10, "objetivo": "Con Triton congelado, classify sale con 504 a tiempo y /healthz sigue vivo.", "check": "plazos", "pista": "¿Quién corta la llamada: el timeout de infer() o tú?"},
        {"n": 11, "objetivo": "Una línea de JSON por request (también el 422) y la latencia sin los 4xx.", "check": "log"},
        {"n": 12, "objetivo": "Al menos 15 pruebas en verde, sin Triton.", "check": "pruebas"},
    ],
}

FAL = []


def falla(id_, titulo, tipo, historia, sintoma, hipotesis, confirma_code, confirma_salida, arreglo, concepto, check, nota=""):
    FAL.append(dict(id=id_, titulo=titulo, tipo=tipo, historia=historia, sintoma=sintoma, hipotesis=hipotesis,
                    confirma=cmd(confirma_code, confirma_salida, nota), arreglo=arreglo, concepto=concepto, check=check))


if LOGF:
    falla("plazos-invertidos", "Más plazo para Triton", "config",
          "En la hora pico hubo una ráfaga de 504. El equipo de plataforma subió un commit a gateway.yaml directo a main y redesplegó el gateway: «le dimos más plazo a Triton, ya no debería cortar».",
          "<code>verificar.py</code>: " + F("f1 detecta", filtro=r"^✗ (reglas|salud)"),
          ["Alguien cambió las reglas del gateway.", "Se cayó Triton.", "Se cayó el gateway por otra cosa."],
          "git log -1 --format=\"%h %an · %s\" -- gateway.yaml\ngit show HEAD -- gateway.yaml | grep \"^[-+] \"\npython mundo/servicios.py estado\ntail -3 logs/gateway.log", F("f1 confirma"),
          "Un commit sin revisión dejó <code>plazos_ms.triton: 400</code>: la llamada a Triton podría esperar más que la request entera y que la app. La app se rendiría primero mientras el gateway sigue esperando: más 504, no menos. Tu gateway se niega a arrancar con la cadena al revés, y está bien. Arreglo: <code>git revert --no-edit HEAD</code> y <code>python mundo/servicios.py arrancar gateway</code>. Los 504 de la hora pico se investigan con <code>ms.triton</code> del log y las métricas de Triton, no estirando el plazo.",
          "cadena-plazos", "reglas")
    falla("limites-flojos", "Más throughput", "config",
          "El equipo de plataforma vio la CPU del gateway al 40 % y subió un commit: «64 en vuelo y 8 decodes a la vez; así aprovechamos la máquina». Redesplegaron el gateway y todo responde.",
          "<code>verificar.py</code>: " + F("f2 detecta", filtro=r"^✗"),
          ["Alguien cambió los topes.", "Las pruebas están mal.", "El gateway se volvió lento."],
          "git log -1 --format=\"%h %an · %s\" -- gateway.yaml\ngit show HEAD -- gateway.yaml | grep \"^[-+] \"\npython verificar.py reglas", F("f2 confirma"),
          "<code>en_vuelo: 64</code> y <code>decodes: 8</code>, sin revisión. Hoy todo responde porque llegan fotos normales; el problema es el peor momento: 64 bodies de 10 MiB y 8 decodes de 40 MP son ≈ 3 GiB en una copia de 1 GiB. La primera ráfaga de fotos grandes mata al proceso por memoria y con él a las 63 requests que tenía adentro. Arreglo: <code>git revert --no-edit HEAD</code> y <code>python mundo/servicios.py reiniciar gateway</code>. Si falta throughput, se agregan copias (estación 9), no lugares en una.",
          "en-vuelo", "reglas")
    falla("modelo-equivocado", "El hotfix de septiembre", "mundo",
          "Alguien de plataforma escribió en el canal: «el modelo de octubre daba resultados raros en mi prueba, puse el de septiembre en el repositorio mientras y reinicié Triton». Todo responde 200.",
          "<code>verificar.py</code>: " + F("f3 detecta", filtro=r"^✗"),
          ["Cambió el engine que carga Triton.", "Cambió el preprocess.", "Cambiaron los labels."],
          "shasum -a 256 model_repository/classifier/1/model.onnx | cut -c1-12\ngrep \"successfully loaded\" logs/triton.log\npython mundo/modelos.py engine 4 | grep engine_sha256", F("f3 confirma"),
          "El <code>model.onnx</code> del repositorio es el engine de v3, copiado a mano, y Triton lo cargó al reiniciar. El gateway sigue diciendo <code>miniresnet-2026-10-01</code>: cada respuesta afirma ser un modelo que no es, con código 200. Lo delatan las huellas: la del archivo, la que Triton anota en su log y el tag de v4. Arreglo: <code>python servir/armar.py</code> (vuelve a bajar el engine aprobado y compara su huella) y <code>python mundo/servicios.py reiniciar triton</code>. En C01 el model repository va dentro de la imagen de Triton: nadie lo cambia «mientras».",
          "model-repository", "repositorio")
    falla("labels-desordenados", "Las categorías en orden", "mundo",
          "Un script de limpieza de plataforma «normalizó» los artefactos del registro: «dejamos los labels.json en orden alfabético, como en los demás modelos». El gateway sigue respondiendo bien.",
          "<code>verificar.py</code>: " + F("f4 detecta", filtro=r"^✗"),
          ["Cambiaron los labels en el registro.", "Cambió el engine.", "Cambió tu ficha del modelo."],
          "python servir/armar.py\npython mundo/modelos.py labels 4", F("f4 confirma"),
          "El <code>labels.json</code> de la corrida de v4 quedó en orden alfabético: los artefactos de una corrida se pueden reemplazar. El gateway responde bien porque su ficha se armó antes; el daño llegaría con el próximo armado: <code>abrigos</code> sería la posición 0 y cada respuesta diría otra categoría con buena confianza y código 200. Tu <code>armar.py</code> compara la huella con el tag <code>labels_sha256</code> y se niega. Arreglo: <code>python mundo/modelos.py reparar-labels 4</code> y <code>python servir/armar.py</code>.",
          "model-repository", "repositorio")
    falla("triton-trabado", "El servidor que no contesta", "infra",
          "Desde hace unos minutos, todas las fotos salen con 504. El gateway está vivo: su /healthz contesta 200.",
          "<code>verificar.py</code>: " + F("f5 detecta", filtro=r"^✗ (triton|salud|responde)"),
          ["Triton está trabado.", "El gateway está trabado.", "La red está lenta."],
          "python mundo/servicios.py estado\ngrep '\"status\": 504' logs/gateway.log | tail -1", F("f5 confirma"),
          "El proceso de Triton está congelado (SIGSTOP; en C01 sería una GPU o un driver colgados): acepta conexiones pero no contesta. Tu gateway hace lo correcto: corta cada llamada a los 150 ms con 504, <code>/readyz</code> dice 503 (Kubernetes sacaría la copia del reparto) y <code>/healthz</code> sigue en 200 (reiniciar el gateway no arreglaría nada). Arreglo: <code>python mundo/servicios.py reiniciar triton</code>. En C01, el liveness probe de Triton lo reinicia solo.",
          "vivo-listo", "triton")
    falla("mlflow-caido", "El registro no contesta", "infra",
          "El canal de plataforma avisa que MLflow está en mantenimiento. Alguien pregunta: «¿se cayó también el clasificador?».",
          "<code>verificar.py</code>: " + F("f6 detecta", filtro=r"^✗|en verde"),
          ["Se cayó MLflow.", "Se cayó el clasificador.", "Se cayó el S3."],
          "docker compose ps -a --format \"{{.Service}}: {{.State}} · {{.Status}}\"\ncurl -s -o /dev/null -w \"classify → %{http_code}\\n\" -X POST localhost:8701/v1/classify \\\n  -H \"Content-Type: image/jpeg\" --data-binary @fotos-raras/tenis.jpg\npython servir/armar.py", F("f6 confirma"),
          "MLflow está detenido, y el clasificador NO se cayó: Triton y el gateway ya tienen todo lo que necesitan (el engine en el repositorio y la ficha con sus labels), y siguen respondiendo 200. Lo que no se puede es armar un repositorio nuevo: <code>armar.py</code> falla en segundos, y está bien que falle. Servir no depende del registro en cada request; desplegar, sí. Arreglo: <code>docker compose up -d --wait mlflow</code>.",
          "gateway", "mundo")
e["fallas"] = FAL

e["listo"] = [
    "El model repository tiene la copia exacta del engine aprobado, por número y con su huella, y la ficha del gateway trae sus labels con su huella.",
    "El config.pbtxt cuadra con el engine, junta lotes con una ventana corta, rechaza lo que esperó demasiado, carga dos copias y se calienta antes de decir «listo».",
    "El gateway revisa cada foto de lo barato a lo caro y contesta cada falla con su código, también las que pasan antes o fuera de classify.",
    "Los topes salen de la memoria del peor momento, y la cadena de plazos baja de la app a la fila de Triton.",
    "Cada request deja una línea de JSON y sus métricas, con nombres fijos y sin los 4xx en la latencia.",
    "Las pruebas cubren la tabla de códigos con un Triton falso y corren en segundos sin GPU.",
]

e["repaso"] = {
    "memo": "<b>Servir un modelo no es llamarlo: es protegerlo.</b> Triton carga el engine aprobado con su <code>config.pbtxt</code> (batching con ventana corta, fila que rechaza, copias y warmup). El gateway revisa de lo barato a lo caro, decodifica en un hilo con semáforo, rechaza la 17 en vuelo al instante, le da a Triton min(150, lo que queda) y contesta siempre con un código que dice qué pasó, con una línea de log y sus métricas.",
    "trampa": "Estirar un plazo o subir un tope porque «hoy no alcanza»: los plazos tienen que bajar de afuera hacia adentro y los topes salen de la memoria del peor caso, no de la CPU de hoy.",
    "entrevista": [
        {"q": "Diseña el servicio que sirve un clasificador de imágenes con p99 ≤ 200 ms.", "a": "Un gateway en FastAPI en CPU, varias copias, delante de Triton en GPU. El gateway revisa la foto de lo barato a lo caro, decodifica en un threadpool con semáforo, tiene un tope de requests en vuelo, y llama a Triton con el tensor en binario y un plazo que es el mínimo entre su tope y lo que le queda a la request. Triton con batching dinámico de pocos ms, fila con timeout, dos instancias por GPU y warmup. /healthz sin dependencias, /readyz que pregunta a Triton, una línea de log por request y métricas con nombres fijos."},
        {"q": "¿Por qué separar gateway y servidor de modelos?", "a": "Escalan distinto: los gateways son CPU barata y muchas copias; las GPUs son caras y pocas. El decode y la validación de bytes hostiles se quedan fuera del proceso con la GPU. Y Triton hace batching dinámico, que un proceso de FastAPI con el modelo adentro no hace."},
        {"q": "¿Qué pasa si Triton se traba?", "a": "Cada llamada se corta por el plazo con 504; /readyz pregunta a Triton con su propio tope y dice 503, así Kubernetes saca esa copia del reparto sin reiniciarla; /healthz no pregunta a nadie y sigue en 200, porque reiniciar gateways no arregla a Triton. Sin reintentos, para no sumar carga a un sistema que ya no puede."},
        {"q": "¿Cómo eliges el tope de requests en vuelo?", "a": "Con la Ley de Little: llegadas por segundo por lo que dura cada una, en el caso normal y en el lento. Y lo recorto por la memoria del peor momento: cada request en vuelo puede traer un body del máximo y cada decode puede ser de una foto enorme. Lo que sobra recibe 503 al instante."},
        {"q": "¿Qué es una bomba de descompresión y cómo te defiendes?", "a": "Una imagen que pesa poco comprimida y muchísimo decodificada. Leo el ancho y el alto del encabezado sin decodificar (Image.open) y rechazo por píxeles antes del decode, además de la red de Pillow (MAX_IMAGE_PIXELS) y un semáforo que limita cuántos decodes caben a la vez."},
        {"q": "¿Cómo pruebas el gateway sin GPU?", "a": "Con un Triton falso que tiene los mismos métodos asíncronos y las mismas excepciones que el cliente real, y que revisa el nombre, el tipo y la forma del tensor que le mandan. Así cubro cada fila de la tabla de códigos (incluidos 499, 500 con NaN, 503 y 504) en segundos, en cualquier máquina."},
    ],
}

e["prompts"] = {
    "claude_md": "kits/c01-serving/CLAUDE.md",
    "guiado": "content/estaciones/c01-serving/prompts/guiado.md",
    "solo": "content/estaciones/c01-serving/prompts/solo.md",
    "romper_ayuda": "content/estaciones/c01-serving/prompts/romper-ayuda.md",
    "romper_solo": "content/estaciones/c01-serving/prompts/romper-solo.md",
}

(APP / "content/estaciones/c01-serving.json").write_text(json.dumps(e, ensure_ascii=False, indent=2) + "\n")
print("ok", len(json.dumps(e, ensure_ascii=False)), "· fallas:", len(FAL))
