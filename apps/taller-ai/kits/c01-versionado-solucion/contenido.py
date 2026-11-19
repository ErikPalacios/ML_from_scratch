"""Arma content/estaciones/c01-versionado.json con las salidas reales de probar.sh y probar-fallas.sh.

    bash probar.sh /tmp/v1 && bash probar-fallas.sh /tmp/v1     # deja /tmp/v1.log y /tmp/v1-fallas.log
    python3 contenido.py /tmp/v1                                 # escribe el JSON con esas salidas

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
LOGF = Path(f"{CARPETA}-fallas.log").read_text()


def L(nombre: str, log: str = None, filtro=None, max_lineas=None) -> str:
    log = LOG if log is None else log
    m = re.search(r"^### " + re.escape(nombre) + r"\n(.*?)(?=^### |\Z)", log, re.S | re.M)
    if not m:
        sys.exit(f"no está la sección «{nombre}»")
    t = m.group(1).rstrip("\n")
    lineas = t.splitlines()
    if filtro:
        lineas = [l for l in lineas if re.search(filtro, l)]
    if max_lineas:
        lineas = lineas[:max_lineas]
    return "\n".join(lineas).rstrip()


def F(nombre, **kw):
    return L(nombre, LOGF, **kw)


def code(rel: str) -> str:
    return (SOL / rel).read_text().rstrip("\n")


def cmd(code_, salida, nota="", donde="mac"):
    return {"code": code_, "nota": nota, "donde": donde, "salida": salida}


V = "python verificar.py"

e = {
    "id": "versionado", "patron": "sincrono", "caso": "c01", "num": 2,
    "titulo": "Versionado y linaje", "nav": "Versionado",
    "pregunta": "¿Cómo sabes, meses después, con qué datos exactos se entrenó un modelo?",
    "version": "2026-11-15",
}

e["mapa"] = {
    "resumen": "La estación 1 deja los labels del mes. Esta los convierte en un <b>snapshot inmutable</b>: una lista con id (<code>ds-2026-09-01</code>) que cita cada foto por su llave y su huella sha256, con una tarjeta que dice de dónde salió. No copia fotos: las referencia, así que un snapshot nuevo pesa ≈ 0.1 % de las imágenes en C01. Cada modelo guarda tres punteros (el snapshot, el commit y el entorno) y con eso respondes «¿con qué datos?», «¿lo puedo reproducir?» y «¿en qué modelos está esta foto que pidieron borrar?». La estación 3 entrena con ese id.",
    "entra": [
        "los labels del mes como eventos (quien vende, moderación y etiquetado humano), con su hora en UTC",
        "las publicaciones: cada foto con su llave y su sha256, quién la vende y cuándo",
        "el golden set congelado y el registro de borrados",
        "el snapshot anterior, <code>ds-2026-08-01</code> (el padre)",
    ],
    "sale": [
        "el snapshot <code>ds-2026-09-01</code> en S3: <code>rows.parquet</code> (el manifest), <code>validation.json</code> y la tarjeta <code>snapshot.json</code>, escritos una sola vez",
        "el reporte de validación del contrato de datos",
        "el pipeline como DAG (<code>dvc.yaml</code> + <code>dvc.lock</code>), en un commit",
        "una corrida con sus tres punteros y la búsqueda de una foto hacia sus snapshots y modelos",
    ],
    "escala": [
        {"que": "Filas del snapshot", "c01": "1,932,628 fotos (1,840,211 train · 92,417 val)", "taller": "2,467 fotos (2,309 train · 158 val)"},
        {"que": "Lo que cita", "c01": "≈ 387 GB de fotos de ≈ 200 KB; el manifest ≈ 97 MB en Parquet", "taller": "6.1 MB de fotos de juguete de ≈ 2.3 kB; el manifest 242 kB en Parquet"},
        {"que": "Split", "c01": "sha256(seller_id) mod 100 &lt; 95 → train", "taller": "sha256(seller_id) mod 100 &lt; 90 → train (con 300 vendedores, el 5 % dejaría muy pocos en val)"},
        {"que": "Dónde vive", "c01": "Amazon S3, con versionado y una política del bucket que exige <code>If-None-Match: *</code>", "taller": "RustFS en tu Mac, con versionado; la escritura condicional la pone tu código"},
        {"que": "Quién lo arma cada mes", "c01": "el pipeline mensual en el orquestador (por ejemplo Kubeflow Pipelines), con caché por paso", "taller": "<code>dvc repro</code> sobre <code>dvc.yaml</code>, con la caché de DVC"},
        {"que": "Dónde quedan los punteros", "c01": "MLflow: parámetros y tags de la corrida, y el digest de la imagen de entrenamiento", "taller": "<code>corridas/*.json</code> y la huella de los paquetes instalados"},
    ],
    "hoja": "https://hojas.trueml.app/recorrido/#est-versionado",
}

e["precalculos"] = {
    "intro": "Antes de escribir el pipeline, las cuentas de servilleta del versionado: cuánto pesa un snapshot que cita en vez de copiar, cuánto cuesta guardar un año, cuánto cuesta comprobar cada huella al leer, qué pasa si el split se sortea cada mes y cuántas filas son normales. Cada cuenta va en las dos escalas: C01 y el dojo.",
    "cuentas": [
        {
            "id": "peso", "pregunta": "¿Cuánto pesa el manifest comparado con las fotos que cita?",
            "formula": "manifest = filas × bytes por fila; fotos = filas × bytes por foto; la fracción es bytes por fila ÷ bytes por foto",
            "c01": {"cuenta": "1,932,628 filas × ≈ 200 B = ≈ 387 MB sin comprimir, contra 1,932,628 × ≈ 200 KB = ≈ 387 GB de fotos", "valor": "≈ 0.1 % (y ≈ 97 MB ya en Parquet)"},
            "taller": {"cuenta": "≈ 2,600 filas × ≈ 200 B = ≈ 0.5 MB, contra 3,120 fotos de ≈ 2.3 kB (7.3 MB)", "valor": "≈ 9 % sin comprimir: las fotos de juguete son 100 veces más chicas que las de C01"},
            "decide": "Un snapshot cita, no copia: guardar uno cada mes cuesta casi nada. La proporción depende solo de cuánto pesa cada foto, no de cuántas hay.",
            "conceptos": ["manifest", "snapshot"],
            "comprueba": cmd("python -c \"import pandas as pd; p = pd.read_parquet('entrada/publicaciones.parquet'); print(f'{len(p)} publicaciones · {p.bytes.sum() / 1e6:.1f} MB de fotos · {p.bytes.mean() / 1e3:.1f} kB por foto en promedio')\"", L("pc fotos")),
            "confirma": "el paso 2: el manifest real pesa 246 kB en Parquet y cita 6.1 MB de fotos (≈ 4 %).",
        },
        {
            "id": "costo", "pregunta": "¿Cuánto cuesta guardar un año de snapshots citando, contra copiar las fotos cada mes?",
            "formula": "citar = snapshots × manifest comprimido × precio; copiar = snapshots × fotos × precio",
            "c01": {"cuenta": "12 × 97 MB = 1.16 GB × US$0.023 por GB al mes, contra 12 × 387 GB × 0.023 (S3 Standard, us-east-1)", "valor": "≈ US$0.03 al mes contra ≈ US$107 al mes, y copiar crece cada mes"},
            "taller": {"cuenta": "12 × 242 kB ≈ 2.9 MB, contra 12 × 6.1 MB ≈ 73 MB", "valor": "en tu Mac cuesta cero, pero la proporción es la misma idea"},
            "decide": "Un snapshot por mes, para siempre, cabe en el presupuesto. Lo caro es copiar. El precio escondido: si el producto borra una foto, la fila apunta a nada; por eso se comprueba al leer y se anota cada borrado.",
            "conceptos": ["manifest", "registro-borrados"],
            "confirma": "el paso 5: <code>mundo/s3.py versiones</code> muestra <code>rows.parquet</code> de 241,680 B.",
        },
        {
            "id": "huellas", "pregunta": "¿Cuánto tarda comprobar la huella de cada foto al leerla?",
            "formula": "tiempo = bytes de fotos ÷ velocidad de sha256 en un núcleo",
            "c01": {"cuenta": "387 GB ÷ ≈ 2.9 GB/s (lo que mide tu Mac) = ≈ 133 s de CPU en un núcleo", "valor": "≈ 2 minutos, contra las 3–4 horas de GPU del fine-tune"},
            "taller": {"cuenta": "6.1 MB ÷ 2.9 GB/s", "valor": "≈ 2 ms: lo que tarda es leer del S3, no hashear"},
            "decide": "Comprobar cada foto al leer es casi gratis frente al entrenamiento. No hay excusa para no hacerlo: si una foto cambió bajo la misma llave, el entrenamiento se detiene en vez de aprender otra cosa.",
            "conceptos": ["huella"],
            "comprueba": cmd("python -c \"import hashlib, time; b = bytes(512 * 2**20); t = time.perf_counter(); hashlib.sha256(b).hexdigest(); s = time.perf_counter() - t; print(f'sha256 de 512 MiB en {s:.2f} s: {512 / 1024 / s:.1f} GiB/s en un núcleo')\"", L("pc hash"),
                             "En una M4. 2.7 GiB/s son ≈ 2.9 GB/s. Tu número puede variar."),
        },
        {
            "id": "sorteo", "pregunta": "Si el split se sorteara otra vez cada mes, ¿cuántas fotos de validación pasarían a train?",
            "formula": "se mueven = fotos de validación del padre × fracción que va a train",
            "c01": {"cuenta": "92,417 × 0.95", "valor": "≈ 87,796 fotos con que se validó el modelo de octubre entrenarían al de noviembre"},
            "taller": {"cuenta": "131 fotos de validación en ds-2026-08-01 × 0.90", "valor": "≈ 118 de 131"},
            "decide": "El split no se sortea: se calcula con el hash del vendedor, y así se mueven cero. Cambiar el umbral también mueve gente: el umbral se fija una vez y no se toca.",
            "conceptos": ["split-estable"],
            "comprueba": cmd("python -c \"import json, sys; sys.path.insert(0, '.'); from mundo.comun import s3; t = json.loads(s3().get_object(Bucket='ml-datos', Key='datasets/ds-2026-08-01/snapshot.json')['Body'].read()); print('ds-2026-08-01:', t['counts'], '· split:', t['split']['rule'])\"", L("pc padre")),
        },
        {
            "id": "volumen", "pregunta": "¿Cuántas filas son normales para el snapshot nuevo, y cuándo es sospechoso?",
            "formula": "razón = filas nuevas ÷ filas del padre; el contrato acepta entre 0.8 y 1.5",
            "c01": {"cuenta": "con 1,932,628 filas, el padre tendría que estar entre 1,932,628 ÷ 1.5 y 1,932,628 ÷ 0.8", "valor": "entre ≈ 1.29 M y ≈ 2.42 M filas"},
            "taller": {"cuenta": "padre de 2,013 filas × 0.8 y × 1.5", "valor": "entre 1,610 y 3,020 filas; esperas ≈ 2,013 + las de agosto que maduraron"},
            "decide": "Un volumen fuera de rango casi nunca es «el negocio creció»: es un join que duplicó, un corte en la zona horaria equivocada o un filtro que se comió medio mes. El pipeline se detiene antes de gastar GPU.",
            "conceptos": ["contrato-datos"],
            "confirma": "el paso 4: 2,467 filas = 1.23 × las 2,013 del padre.",
        },
    ],
}

C = lambda id_, termino, en, def_, analogia, importa, trampa: dict(id=id_, termino=termino, en=en, def_=def_, analogia=analogia, importa=importa, trampa=trampa)  # noqa: E731
conceptos = [
    C("snapshot", "Snapshot inmutable", "immutable dataset snapshot",
      "Una versión del dataset con id propio (<code>ds-2026-09-01</code>) que, una vez escrita, nadie cambia: ni se borra, ni se reemplaza, ni se le agregan filas.",
      "La foto de grupo de fin de año: si alguien llega tarde, sale en la del año siguiente; no se retoca la de este año.",
      "Es lo que hace que «el modelo de octubre se entrenó con ds-2026-09-01» sea verdad para siempre. Si el contenido cambia, es otro snapshot con otro id.",
      "Inmutable «por acuerdo» no sirve: un script que corre dos veces o alguien que «arregla» una fila lo rompe sin dar error. Tiene que ser por diseño."),
    C("manifest", "Manifest", "manifest",
      "Un archivo (aquí, Parquet) con una fila por foto: su llave, su huella, quién la vende, su label, de dónde salió el label y su split.",
      "La lista de invitados con foto de cada uno, en vez de meter a los invitados en la caja.",
      "Cita las fotos en vez de copiarlas: un snapshot pesa ≈ 0.1 % de las imágenes en C01 y se puede guardar uno por mes para siempre.",
      "Si una foto se borra o cambia bajo la misma llave, la fila apunta a otra cosa. Por eso lleva la huella, y por eso se comprueba al leer."),
    C("huella", "Huella sha256", "content hash (SHA-256)",
      "64 caracteres hexadecimales que salen de los bytes de un archivo: el mismo contenido da siempre la misma huella; un byte distinto, otra.",
      "Una huella digital: no dice cómo es la persona, pero dice si es la misma.",
      "Hay dos: <code>image_sha256</code> (cada foto) y <code>rows_sha256</code> (el manifest entero, en la tarjeta). La segunda la guarda cada modelo: si alguien cambia una sola etiqueta, se nota.",
      "La huella no impide nada: delata. Y depende de los bytes: el mismo contenido escrito en otro orden da otra huella, por eso las filas se ordenan antes de escribir."),
    C("tarjeta", "Tarjeta del snapshot", "dataset card",
      "Un JSON chico junto al manifest (<code>snapshot.json</code>): id, padre, corte, conteos, mezcla de fuentes, regla del split, commit del código, <code>rows_sha256</code> y resultado de la validación.",
      "La etiqueta de un frasco de laboratorio: qué hay, de qué lote salió, quién lo preparó y cuándo.",
      "El manifest dice qué hay; la tarjeta, de dónde salió y cómo comprobarlo. Se escribe al final: un snapshot sin tarjeta no existe.",
      "El commit de la tarjeta es el del código que <b>armó</b> el snapshot, no el que entrena. Cada artefacto apunta a su propio código."),
    C("label-evento", "Labels como eventos", "append-only label events",
      "Cada label es una fila nueva que nunca se edita, con su fuente, su guía y su hora. Corregir es agregar otro evento más nuevo.",
      "El historial de un expediente médico: el diagnóstico nuevo no borra el viejo, se escribe abajo con fecha.",
      "Con eso, un snapshot es una consulta: «para cada foto, el label más reciente que ya existía a tal hora». Nada se pierde y se puede explicar por qué el modelo de agosto aprendió lo que aprendió.",
      "Si la tabla guarda una fila por foto y la corrección la reescribe, ya no sabes qué label había el día del corte."),
    C("point-in-time", "Corte (point-in-time)", "point-in-time cutoff",
      "La hora, en UTC, hasta la que cuenta lo que existe: un snapshot solo ve eventos de antes del corte.",
      "El cierre de una votación: los votos que llegan después cuentan para la siguiente.",
      "Hace que el snapshot sea reproducible: correrlo hoy o en un año da lo mismo, aunque sigan llegando eventos. También el registro de borrados se lee al corte.",
      "Un corte sin zona horaria (<code>2026-10-01 00:00</code>) se interpreta en la hora de la máquina: en México son 6 horas de diferencia y se cuelan eventos."),
    C("split-estable", "Split estable", "stable split (hash-based)",
      "Cada vendedor cae en train o en val por el hash de su <code>seller_id</code> (cubeta = sha256 mod 100) y se queda ahí en todas las versiones.",
      "El número de lista en la escuela: el mismo alumno tiene el mismo número todo el año, aunque entren alumnos nuevos.",
      "Comparar el modelo nuevo contra el viejo solo es justo si ninguno vio el examen del otro. Los vendedores nuevos caen donde les toque, sin mover a nadie.",
      "Sortear otra vez, o mover el umbral «para tener más validación», manda a val vendedores con los que el modelo anterior ya entrenó."),
    C("dedupe", "Duplicados por huella", "hash-based deduplication",
      "La misma foto subida en varias publicaciones cuenta una sola vez: de cada huella queda la fila de la publicación más vieja.",
      "Tres copias del mismo examen con distinto nombre en la portada: se califica una.",
      "Si la misma foto cayera en train y en val, la validación premiaría memorizar. Pasa con vendedores que republican y con fotos de catálogo que usan dos tiendas.",
      "Deduplicar por llave no sirve: cada publicación tiene su llave. Lo que se repite son los bytes, o sea la huella."),
    C("contrato-datos", "Contrato de datos", "data contract",
      "Las reglas que los datos cumplen antes de entrenar: esquema exacto, categorías válidas, cero duplicados, cero golden, split por vendedor y estable, volumen en rango y tope de labels débiles.",
      "La revisión de un avión antes de despegar: una lista fija, la misma cada vez, y si un punto falla no se despega.",
      "Detiene el pipeline antes de gastar GPU. Cada regla viene de un error real: un join que duplica, el golden en train, un split que se movió.",
      "Un contrato que solo avisa y deja seguir no es contrato: el paso de validar tiene que fallar (código de salida 1) para que nada se publique."),
    C("write-audit-publish", "Escribir, auditar, publicar", "write-audit-publish",
      "El snapshot se arma aparte, se audita con el contrato y solo si pasa se publica, con la tarjeta al final.",
      "Imprimir el periódico de prueba, revisarlo y solo entonces mandarlo a todos los puestos.",
      "Un job que se cae a medias no deja un snapshot «a medias» que alguien pueda usar: sin tarjeta no existe. En el dojo, «aparte» es <code>data/</code> en tu Mac; en C01, un prefijo <code>staging/</code>.",
      "Publicar la tarjeta primero (o en medio) abre la puerta a entrenar con algo que nadie revisó."),
    C("escritura-condicional", "Escritura condicional", "conditional write (If-None-Match: *)",
      "Un PUT que solo se cumple si la llave no existe. Si ya existe, S3 responde 412 Precondition Failed y no toca nada.",
      "Un buzón con candado: puedes dejar una carta nueva, pero no cambiar la que ya está adentro.",
      "Sin ella, un PUT a una llave que existe reemplaza el objeto en silencio: gana el último. Con ella, reescribir un snapshot es un error ruidoso.",
      "El header lo pone quien escribe: un script que no lo pone escribe igual. En AWS se vuelve obligatorio con la política del bucket; RustFS no tiene esa condición, así que aquí depende de tu código. Y con versiones solo mira la versión vigente: si es una marca de borrado, el PUT pasa."),
    C("versionado-bucket", "Versionado del bucket", "S3 Versioning y delete markers",
      "Con el versionado prendido, un PUT a una llave existente guarda una versión nueva sin destruir la vieja, y un DELETE solo pone una marca de borrado encima.",
      "Un documento con historial de cambios: puedes volver a cualquier versión, y borrar es tachar, no quemar.",
      "Es la red de seguridad: lo que se pisó o se borró por error se recupera borrando la versión mala o la marca. Y deja rastro de cada reescritura.",
      "Protege versiones, no llaves: el PUT nuevo pasa y es lo que se lee. Y para un borrado por ley hay que borrar cada versión, no solo poner la marca."),
    C("dag-cache", "DAG y caché de pasos", "pipeline DAG y step cache",
      "El pipeline como pasos con flechas (qué lee y qué deja cada uno). La herramienta guarda la salida de cada paso con una llave hecha de su código, sus parámetros y sus entradas, y la reusa si la llave no cambió.",
      "Una receta con pasos: si ya picaste la cebolla y nadie cambió la cebolla, no la vuelves a picar.",
      "Ahorra horas y hace que repetir el pipeline sea seguro. <code>dvc.lock</code> guarda las huellas de cada entrada y salida: también es linaje.",
      "Lo que no está en la llave no existe para la caché: un parámetro que el script lee pero el stage no declara no hace correr el paso, y sale la salida vieja."),
    C("parametro-no-carpeta", "Id como parámetro, nunca «latest»", "pass the snapshot id, not a moving path",
      "Toda entrada que cambia el resultado llega como un id fijo (<code>ds-2026-09-01</code>), nunca como una carpeta que cambia de contenido sin cambiar de nombre.",
      "Pedir «el libro con ISBN tal» en vez de «el libro de la repisa de arriba»: alguien puede cambiar el de la repisa.",
      "La corrida guarda un puntero que siempre dice lo mismo. Con <code>latest</code>, el registro no dice con qué entrenó y la caché ve la misma llave dos meses seguidos.",
      "«Para no editar params.yaml cada mes» es la excusa típica. Cambiar el id cada mes es trabajo del orquestador, no de una carpeta mágica."),
    C("linaje", "Linaje", "lineage",
      "La cadena de qué salió de qué: modelo ← corrida ← snapshot (id + rows_sha256) ← cada foto (llave + huella), más el commit y el entorno. Se guarda como punteros, no como copias.",
      "El árbol genealógico con acta de nacimiento en cada rama.",
      "Responde en un minuto las tres preguntas: con qué datos se entrenó, si cambió el código o los datos, y en qué modelos está la foto que pidieron borrar.",
      "Un puntero que se escribe a mano o «después» se desfasa. Lo escribe el mismo programa que entrena, en el momento."),
    C("arbol-limpio", "Commit con el árbol limpio", "clean working tree",
      "Entrenar (y publicar) solo desde un commit sin cambios pendientes en el código, para que el commit diga exactamente qué corrió.",
      "Firmar un contrato solo cuando ya no tiene tachones a mano.",
      "El commit es uno de los cinco ingredientes de la reproducibilidad (código, datos, configuración, entorno y semilla). Si el script tenía cambios sin commit, el puntero apunta a otro código.",
      "<code>dvc repro</code> cambia <code>dvc.lock</code>: hay que hacer commit después de cada repro, antes de entrenar."),
    C("registro-borrados", "Registro de borrados", "deletion log (tombstones)",
      "Una lista de solo agregar con la huella de cada foto que se borró, la fecha y el motivo.",
      "La lista de bajas de un club: no se arranca la hoja del acta vieja, se anota la baja con fecha.",
      "Respeta el derecho al borrado sin romper la historia: los snapshots viejos no se reescriben, el siguiente ya no la incluye y el entrenamiento la salta al leer.",
      "Borrar la foto del bucket sin anotarlo deja filas que apuntan a nada y un entrenamiento que truena; anotarlo sin borrar no cumple la solicitud."),
    C("idempotencia", "Paso idempotente", "idempotent step",
      "Correrlo dos veces deja lo mismo que correrlo una.",
      "El botón del elevador: picarle cinco veces no llama cinco elevadores.",
      "El orquestador reintenta pasos que fallan a la mitad. Publicar otra vez el mismo contenido sigue sin error; otro contenido con el mismo id se detiene.",
      "Idempotente no es «sobrescribe sin preguntar»: eso borra la historia. Es «si ya está igual, no hago nada»."),
]
for c in conceptos:
    c["def"] = c.pop("def_")
e["conceptos"] = conceptos

e["mundo"] = {
    "resumen": "El kit trae el marketplace de C01 seis meses después de la estación 1, a principios de octubre de 2026: 3,120 publicaciones de abril a septiembre con sus fotos en un S3 local, los labels como eventos, el golden set, un registro de borrados y el snapshot de agosto que publicó el equipo. Tú escribes el pipeline que arma el de septiembre y el entrenamiento que deja el linaje. Todo corre con un entorno virtual de Python y un contenedor.",
    "trae": [
        {"que": "El S3 local (compose.yaml)", "detalle": "RustFS en el puerto 9300, con dos buckets: <code>fotos</code> (el del producto) y <code>ml-datos</code> (el de ML, con versionado)."},
        {"que": "mundo/crear.py", "detalle": "Crea todo con semilla fija en ≈ 10 s: las 3,120 fotos de juguete (64×64, el color y la forma dependen de la categoría), la entrada y el snapshot <code>ds-2026-08-01</code>."},
        {"que": "entrada/", "detalle": "Lo que dejó la estación 1 y el producto: <code>publicaciones.parquet</code>, <code>labels-eventos.parquet</code> (3,908 eventos, 112 después del corte), <code>golden.parquet</code> (280 huellas), <code>borrados.csv</code> (las 14 fotos de una vendedora que pidió borrar) y <code>categorias.json</code>."},
        {"que": "corridas/run-20260901-061500.json", "detalle": "La corrida del modelo de septiembre, que entrenó con <code>ds-2026-08-01</code>: el registro de corridas (en C01, MLflow)."},
        {"que": "mundo/s3.py", "detalle": "Mirar y reparar el S3 con permisos de administrador: <code>ls</code>, <code>versiones</code> (con la huella de cada versión), <code>borrar-version</code> y <code>versionado</code>. En C01, el AWS CLI."},
        {"que": "verificar.py y romper.py", "detalle": "12 checks con los criterios de «listo» y 7 fallas en el mundo, la configuración o la infraestructura, nunca en lo que escribes."},
    ],
    "tu_pipeline": [
        {"archivo": "pipeline/1_labels.py", "hace": "Los labels vigentes al corte, con la regla de 30 días para quien vende."},
        {"archivo": "pipeline/2_manifest.py", "hace": "Una fila por foto con su llave y su huella."},
        {"archivo": "pipeline/3_split.py", "hace": "Sin borrados, sin duplicados, sin golden, y el split estable por vendedor."},
        {"archivo": "pipeline/4_validar.py", "hace": "El contrato de datos: 8 reglas, y si una falla no se publica nada."},
        {"archivo": "pipeline/5_publicar.py", "hace": "El snapshot en S3 con escritura condicional y la tarjeta al final."},
        {"archivo": "dvc.yaml", "hace": "Los pasos 1 a 5 como DAG, con sus entradas, parámetros y salidas."},
        {"archivo": "pipeline/6_entrenar.py", "hace": "Entrenar con un id, comprobando cada huella, y dejar los tres punteros."},
        {"archivo": "pipeline/7_linaje.py", "hace": "De una foto a sus snapshots, sus modelos y su borrado."},
    ],
    "requisitos": [
        "Docker Desktop corriendo, con ≈ 400 MB libres para la imagen de RustFS",
        "Python 3.11 o más nuevo (se probó con 3.14.3) y ≈ 300 MB para el entorno virtual",
        "git (con tu nombre y correo configurados)",
        "Los puertos 9300 y 9301 libres en tu Mac",
    ],
    "sustituciones": [
        {"nube": "Amazon S3 con política del bucket", "local": "RustFS en localhost:9300", "diferencia": "La misma API: versionado, marcas de borrado y PUT con If-None-Match (412) funcionan igual. RustFS no acepta la condición s3:if-none-match en una política, así que la escritura condicional depende de tu código; en AWS la política la vuelve obligatoria para todos."},
        {"nube": "El orquestador del pipeline mensual (por ejemplo Kubeflow Pipelines)", "local": "DVC: dvc.yaml + dvc repro", "diferencia": "Los dos arman un DAG y reusan la salida de un paso si su llave no cambió. El orquestador corre en un clúster, con horario y reintentos; DVC corre en tu Mac cuando tú lo llamas."},
        {"nube": "MLflow (parámetros y tags de la corrida)", "local": "corridas/*.json", "diferencia": "Los mismos punteros en un JSON por corrida. MLflow los guarda en un servidor, con interfaz y búsqueda; lo verás en la estación 3."},
        {"nube": "El digest de la imagen de entrenamiento", "local": "huella_entorno(): sha256 de los paquetes instalados", "diferencia": "El digest fija todo el contenedor (sistema, CUDA, drivers); la huella de paquetes solo fija las versiones de Python."},
    ],
    "arranque": "unzip c01-versionado.zip && cd c01-versionado\npython3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt\ndocker compose up -d --wait\npython mundo/crear.py\ngit init && git add -A && git commit -m \"kit recién descomprimido\"\ndvc init && git commit -m \"dvc init\"\npython verificar.py mundo",
    "python": "python",
}

G = []
G.append(dict(n=0, id="mundo", titulo="Levantar el mundo", objetivo="El S3 local arriba, el mundo creado y la carpeta como repositorio de git con DVC.",
    conceptos=["snapshot"],
    explica="El mundo vive en dos lugares: las fotos y los snapshots en el S3 local, y la entrada en <code>entrada/</code>. <code>mundo/crear.py</code> lo crea igual cada vez (semilla fija), incluido el snapshot de agosto que publicó el equipo: es el <b>padre</b> del tuyo. La carpeta tiene que ser un repositorio de git desde el inicio: el commit es uno de los punteros del linaje, y DVC guarda sus huellas junto al código.",
    codigo=[],
    comandos=[
        cmd("python3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt", L("p0 venv"), "Tarda ≈ 1 minuto la primera vez. Desde aquí, cada terminal nueva necesita <code>source .venv/bin/activate</code>."),
        cmd("docker compose up -d --wait\npython mundo/crear.py", L("p0 up") + "\n" + L("p0 crear")),
        cmd("git init && git add -A && git commit -m \"kit recién descomprimido\"\ndvc init && git commit -m \"dvc init\"\ngit log --oneline", L("p0 git"), "Los ids de commit cambian en cada máquina."),
        cmd(f"{V} mundo", L("p0 verificar")),
    ],
    verifica="<code>verificar.py mundo</code> en verde.",
    ojo="Si el 9300 está ocupado, <code>lsof -nP -iTCP:9300 -sTCP:LISTEN</code> te dice quién. La consola web de RustFS está en http://localhost:9301 (usuario <code>taller</code>, contraseña <code>taller-secreto</code>): ahí ves los dos buckets."))

G.append(dict(n=1, id="labels", titulo="Labels al corte", objetivo="Para cada foto, el label vigente al 1 de octubre a las 00:00 UTC.",
    conceptos=["label-evento", "point-in-time"],
    explica="Los labels llegan como <b>eventos</b>: quien vende elige una categoría al publicar, moderación corrige días después y la cola de etiquetado de la estación 1 agrega labels humanos. Nada se edita. El snapshot de septiembre es una consulta: de los eventos de antes del <b>corte</b>, el más reciente de cada foto. Encima va la regla de la estación 1: una elección de quien vende cuenta solo si ya tiene 30 días sin que nadie la corrija.",
    codigo=[{"lang": "python", "path": "pipeline/1_labels.py", "code": code("pipeline/1_labels.py"), "nota": "<code>utc()</code> de <code>_comun.py</code> rechaza una fecha sin zona: nunca adivina."}],
    comandos=[
        cmd("python pipeline/1_labels.py", L("p1 labels")),
        cmd("python -c \"import pandas as pd; print(pd.read_parquet('data/labels.parquet').head(3).to_string(index=False))\"", L("p1 ver"), "<code>guia_version</code> es nulo cuando el label lo puso quien vende o moderación: la guía es del etiquetado humano."),
        cmd(f"{V} labels", L("p1 verificar")),
    ],
    verifica="2,613 labels: ninguno de después del corte y ninguna elección de quien vende con menos de 30 días.",
    ojo="112 eventos son de después del corte: si entran, el snapshot cambia según el día en que lo corras. Y el orden importa: ordena por hora antes de quedarte con el último."))

G.append(dict(n=2, id="manifest", titulo="El manifest", objetivo="Una fila por label, con la llave y la huella de su foto.",
    conceptos=["manifest", "huella"],
    explica="El manifest no copia fotos: las <b>cita</b> por llave y por huella. La huella la calculó el producto al subir la foto y viene en <code>publicaciones.parquet</code>; el entrenamiento la vuelve a calcular al leer (paso 7). <code>validate=\"one_to_one\"</code> hace que pandas truene si una llave aparece dos veces: un join que duplica filas es el error clásico que infla el volumen.",
    codigo=[{"lang": "python", "path": "pipeline/2_manifest.py", "code": code("pipeline/2_manifest.py"), "nota": ""}],
    comandos=[
        cmd("python pipeline/2_manifest.py", L("p2 manifest"), "2,613 filas pero 2,499 huellas: hay fotos repetidas en varias publicaciones. Se resuelve en el paso 3."),
        cmd(f"{V} manifest", L("p2 verificar")),
    ],
    verifica="Una fila por label, sin huecos, y cada huella igual a la de <code>publicaciones.parquet</code>.",
    ojo="246 kB para citar 6.1 MB: ≈ 4 %. En C01, con fotos de 200 KB, es ≈ 0.1 % (el precálculo «peso»)."))

G.append(dict(n=3, id="split", titulo="Las filas y el split estable", objetivo="Sin borrados, sin duplicados, sin golden, y cada vendedor del mismo lado que en agosto.",
    conceptos=["dedupe", "split-estable", "registro-borrados"],
    explica="Tres filtros y una regla. El <b>registro de borrados</b> también se lee al corte: lo que se borró antes del 1 de octubre ya no entra. De cada <b>huella</b> repetida queda la publicación más vieja, que no cambia mes con mes. El golden set nunca entra a entrenar. Y el split no se sortea: la cubeta del vendedor es su sha256 mod 100, el mismo número hoy y dentro de diez años.",
    codigo=[{"lang": "python", "path": "pipeline/3_split.py", "code": code("pipeline/3_split.py"), "nota": ""}],
    comandos=[
        cmd("python pipeline/3_split.py", L("p3 split")),
        cmd("python -c \"\nimport hashlib\nfor s in ['s-001', 's-002', 's-007', 's-001']:\n    c = int(hashlib.sha256(s.encode()).hexdigest(), 16) % 100\n    print(s, c, 'train' if c < 90 else 'val')\"", L("p3 cubetas"), "El mismo vendedor, la misma cubeta, siempre."),
        cmd(f"{V} split split-estable", L("p3 verificar")),
    ],
    verifica="2,467 filas, un solo lado por vendedor y 0 vendedores que cambiaron de lado contra <code>ds-2026-08-01</code>.",
    ojo="Deduplicar por <code>image_key</code> no quita nada: cada publicación tiene su llave. Lo que se repite son los bytes. Y ordena por <code>image_key</code> antes de escribir: el mismo contenido tiene que dar la misma huella."))

G.append(dict(n=4, id="validar", titulo="El contrato de datos", objetivo="Auditar las filas antes de publicar: 8 reglas, y si una falla, el pipeline se detiene.",
    conceptos=["contrato-datos", "write-audit-publish"],
    explica="Es el «auditar» de <b>escribir, auditar, publicar</b>. Ya escribiste aparte (en <code>data/</code>); ahora se comprueba todo contra reglas fijas. El padre se lee y se comprueba con su huella antes de usarlo: si alguien lo reescribió, la validación del split estable compararía contra algo falso. El código de salida 1 es lo que hace que DVC se detenga.",
    codigo=[{"lang": "python", "path": "pipeline/4_validar.py", "code": code("pipeline/4_validar.py"), "nota": ""}],
    comandos=[
        cmd("python pipeline/4_validar.py", L("p4 validar")),
        cmd(f"{V} validacion", L("p4 verificar")),
    ],
    verifica="<code>data/validation.json</code> con <code>status: passed</code> y las 8 reglas.",
    ojo="Un contrato que imprime un aviso y deja seguir no detiene nada. Cada regla viene de un error real: si dudas de una, pregúntate qué falla real atrapa."))

G.append(dict(n=5, id="publicar", titulo="Publicar sin pisar", objetivo="El snapshot en <code>s3://ml-datos/datasets/ds-2026-09-01/</code>, escrito una sola vez, con la tarjeta al final.",
    conceptos=["escritura-condicional", "tarjeta", "idempotencia", "versionado-bucket", "arbol-limpio"],
    explica="Tres defensas. Cada PUT lleva <code>IfNoneMatch=\"*\"</code>: si la llave existe, S3 responde 412 y no toca nada. Si ya está con el <b>mismo</b> contenido, el paso sigue: correrlo dos veces deja lo mismo (idempotente). La tarjeta va al final: un snapshot sin tarjeta no existe. Y el bucket guarda versiones, así que cualquier reescritura deja rastro. Antes de publicar, tu código va en un commit: la tarjeta guarda ese commit.",
    codigo=[{"lang": "python", "path": "pipeline/5_publicar.py", "code": code("pipeline/5_publicar.py"), "nota": ""}],
    comandos=[
        cmd("python pipeline/5_publicar.py", L("p5 sucio"), "Primero sin commit: se niega."),
        cmd("git add -A && git commit -m \"pipeline: pasos 1 a 5\"\npython pipeline/5_publicar.py", L("p5 publicar")),
        cmd("python pipeline/5_publicar.py", L("p5 otra vez"), "Otra vez: mismo contenido, nada cambia."),
        cmd("python -c \"\nimport sys; sys.path.insert(0, 'pipeline')\nfrom _comun import s3\ntry:\n    s3().put_object(Bucket='ml-datos', Key='datasets/ds-2026-09-01/rows.parquet', Body=b'otra cosa', IfNoneMatch='*')\nexcept Exception as e:\n    print(type(e).__name__, '·', e)\"", L("p5 412"), "Lo que pasa si alguien intenta pisarlo con otro contenido."),
        cmd("python mundo/s3.py versiones ml-datos datasets/ds-2026-09-01/", L("p5 versiones"), "Una versión por llave: nadie lo reescribió."),
        cmd(f"{V} snapshot inmutable", L("p5 verificar")),
    ],
    verifica="La tarjeta, el manifest y el reporte en S3, una versión por llave, y <code>rows_sha256</code> igual al de tu <code>data/rows.parquet</code>.",
    ojo="La tarjeta se ve así (el commit y la hora cambian en tu máquina):\n" + "TARJETA"))

G.append(dict(n=6, id="dag", titulo="El pipeline como DAG", objetivo="Los pasos 1 a 5 en <code>dvc.yaml</code>: <code>dvc repro</code> corre solo lo que cambió.",
    conceptos=["dag-cache", "parametro-no-carpeta"],
    explica="Cada <b>stage</b> dice qué corre, qué lee (<code>deps</code>), qué parámetros de <code>params.yaml</code> usa (<code>params</code>) y qué deja (<code>outs</code>). DVC hashea todo eso y lo guarda en <code>dvc.lock</code>; la próxima vez solo corre un stage si algo de su llave cambió. Es la caché de pasos de un orquestador, en tu Mac. Por eso cada parámetro que lee un script va declarado en su stage, y el snapshot se pide por id.",
    codigo=[{"lang": "yaml", "path": "dvc.yaml", "code": code("dvc.yaml"), "nota": "Las fotos del bucket no son una dependencia de DVC: si una cambia bajo la misma llave, DVC no se entera. Por eso el entrenamiento comprueba cada huella (paso 7)."}],
    comandos=[
        cmd("git add -A && git commit -m \"el pipeline como DAG\"\ndvc repro", L("p6 repro", filtro=r"^(Running stage|>|eventos|fotos|data/|manifest|passed|publicado|  rows|  validation|  snapshot)"), "La primera vez no hay <code>dvc.lock</code>: corre todo. Publicar es idempotente, así que no pasa nada en S3."),
        cmd("dvc repro", L("p6 repro2"), "La segunda: nada cambió, nada corre."),
        cmd("dvc dag", L("p6 dag")),
        cmd("sed -n '1,22p' dvc.lock", L("p6 lock"), "Las huellas (md5) de cada entrada y los valores de los parámetros que usó cada stage: también es linaje."),
        cmd("git add dvc.lock && git commit -m \"ds-2026-09-01\"\n" + f"{V} dag", L("p6 verificar")),
    ],
    verifica="5 stages con sus parámetros declarados y <code>dvc status</code> al día.",
    ojo="Si un script lee <code>split.umbral</code> pero el stage no lo declara, cambiarlo no hace correr nada y DVC te da la salida vieja sin avisar. Es la trampa de <code>latest</code> en otra forma: la llave de la caché no ve lo que cambió."))

G.append(dict(n=7, id="entrenar", titulo="Entrenar con linaje", objetivo="Una corrida que entrena con <code>ds-2026-09-01</code>, comprueba cada huella al leer y deja sus punteros.",
    conceptos=["linaje", "arbol-limpio", "huella", "parametro-no-carpeta"],
    explica="La estación 3 entrena de verdad; aquí importa la entrada y lo que queda anotado. El snapshot llega por <b>id</b>. Se lee la tarjeta primero (sin tarjeta no hay snapshot), se comprueba <code>rows_sha256</code> y la huella de cada foto. Las fotos del registro de borrados se saltan. La corrida guarda los punteros: snapshot y su huella, commit (con el árbol limpio), huella del entorno y semilla.",
    codigo=[{"lang": "python", "path": "pipeline/6_entrenar.py", "code": code("pipeline/6_entrenar.py"), "nota": ""}],
    comandos=[
        cmd("python pipeline/6_entrenar.py", L("p7 sucio"), "Con el script recién escrito y sin commit: se niega."),
        cmd("git add -A && git commit -m \"entrenar con linaje\"\npython pipeline/6_entrenar.py", L("p7 entrenar")),
        cmd("cat $(ls -t corridas/*.json | head -1)", L("p7 corrida")),
        cmd(f"{V} corrida lectura", L("p7 verificar")),
    ],
    verifica="Tu corrida apunta a <code>ds-2026-09-01</code> con su <code>rows_sha256</code>, un commit limpio y la huella del entorno; las 2,467 fotos se leen y coinciden.",
    ojo="0 omitidas: las fotos borradas en septiembre ya no están en este snapshot. Si entrenaras otra vez con <code>ds-2026-08-01</code>, se saltarían 13."))

G.append(dict(n=8, id="linaje", titulo="El linaje al revés", objetivo="De una huella a los snapshots, las corridas y el borrado.",
    conceptos=["linaje", "registro-borrados"],
    explica="La pregunta de privacidad: alguien pide borrar sus fotos, ¿en qué snapshots y en qué modelos están? Con los punteros es mecánico: buscas la huella en los manifests (comprobados con su tarjeta) y sigues las corridas que usaron esos snapshots.",
    codigo=[{"lang": "python", "path": "pipeline/7_linaje.py", "code": code("pipeline/7_linaje.py"), "nota": ""}],
    comandos=[
        cmd("python pipeline/7_linaje.py $(sed -n 2p entrada/borrados.csv | cut -d, -f1)", L("p8 borrada"), "Una foto de la vendedora que pidió borrar: está en el snapshot de agosto y en el modelo de septiembre; el de septiembre ya no la trae."),
        cmd("python pipeline/7_linaje.py 000706ca7a412e4b", L("p8 ambas"), "Una foto que está en los dos snapshots, y por lo tanto en los dos modelos."),
        cmd(f"{V}", L("final"), "Todo junto."),
    ],
    verifica="<code>verificar.py</code> completo: 12/12 en verde.",
    ojo="El modelo de septiembre aprendió con fotos que ya se borraron. Qué hacer con él (reentrenar antes, esperar al siguiente) se decide aparte; el linaje es lo que te deja contestar en un minuto."))

# la tarjeta en el ojo del paso 5
tarjeta = L("p5 tarjeta")
G[5]["ojo"] = "La tarjeta es lo último que se escribe y lo primero que se lee. Compárala con la de agosto (el mismo comando con <code>ds-2026-08-01</code>): mismo formato, otro <code>parent</code>, otro corte y otro commit. Y en la consola web (http://localhost:9301) puedes ver las versiones de cada llave."
G[5]["comandos"].insert(5, cmd("python -c \"import sys; sys.path.insert(0, 'pipeline'); from _comun import s3; print(s3().get_object(Bucket='ml-datos', Key='datasets/ds-2026-09-01/snapshot.json')['Body'].read().decode())\"", tarjeta, "La tarjeta: el commit y la hora cambian en tu máquina."))
e["guiado"] = G

e["solo"] = {
    "reglas": [
        "Antes de empezar, <code>python mundo/reiniciar.py --pipeline</code>: respalda tus archivos en .respaldo/, pone el esqueleto (pipeline/, <code>dvc.yaml</code> vacío, <code>params.yaml</code> de fábrica) y borra <code>data/</code>, tus corridas y los snapshots que publicaste. El de agosto se queda. Haz commit del esqueleto.",
        "Solo tienes OBJETIVOS.md, los contratos al inicio de cada archivo y <code>python verificar.py</code>. Nada de GUION.md ni de <code>mundo/comun.py</code>.",
        "Claude no te da código: te dice qué check falla y te contesta con preguntas.",
        "Mide tu tiempo por objetivo y anota en la bitácora dónde te atoraste.",
    ],
    "objetivos": [
        {"n": 1, "objetivo": "El S3 local arriba, el mundo creado, la carpeta en git y DVC iniciado.", "check": "mundo"},
        {"n": 2, "objetivo": "Los labels vigentes al corte, uno por foto, con la regla de 30 días.", "check": "labels", "pista": "Primero filtra por hora, después ordena y quédate con el último."},
        {"n": 3, "objetivo": "El manifest: una fila por label, con su llave y su huella.", "check": "manifest"},
        {"n": 4, "objetivo": "Las filas del snapshot sin borrados (al corte), sin duplicados, sin golden y con el split por vendedor.", "check": "split", "pista": "De las huellas repetidas, ¿cuál publicación no cambia de un mes a otro?"},
        {"n": 5, "objetivo": "Ningún vendedor cambia de lado contra el snapshot de agosto.", "check": "split-estable"},
        {"n": 6, "objetivo": "El reporte del contrato de datos, con las 8 reglas en verde.", "check": "validacion"},
        {"n": 7, "objetivo": "El snapshot publicado en S3 con su tarjeta, desde un commit, igual a tu <code>data/rows.parquet</code>.", "check": "snapshot"},
        {"n": 8, "objetivo": "Cada llave de datasets/ escrita una sola vez, con versionado y escritura condicional.", "check": "inmutable", "pista": "¿Qué header hace que S3 conteste 412?"},
        {"n": 9, "objetivo": "Los 5 pasos en dvc.yaml, con sus parámetros declarados, y dvc status al día.", "check": "dag"},
        {"n": 10, "objetivo": "Una corrida con un id de snapshot, su huella, un commit limpio, la huella del entorno y la semilla.", "check": "corrida"},
        {"n": 11, "objetivo": "Todas las fotos del snapshot de entrenamiento existen y coinciden, salvo las del registro de borrados.", "check": "lectura"},
        {"n": 12, "objetivo": "De una huella a sus snapshots, sus corridas y su borrado, en JSON con --json.", "check": "linaje"},
    ],
}

FAL = []


def falla(id_, titulo, tipo, historia, sintoma, hipotesis, confirma_code, confirma_salida, arreglo, concepto, check, nota=""):
    FAL.append(dict(id=id_, titulo=titulo, tipo=tipo, historia=historia, sintoma=sintoma, hipotesis=hipotesis,
                    confirma=cmd(confirma_code, confirma_salida, nota), arreglo=arreglo, concepto=concepto, check=check))


if LOGF:
    falla("snapshot-pisado", "El snapshot de agosto ya no es el de agosto", "mundo",
          "Una analista encontró una etiqueta mal en el snapshot de agosto y la «arregló» directo en el bucket, para no esperar al de septiembre. Dice que fue una sola fila.",
          "<code>verificar.py</code>: <code>split-estable</code> e <code>inmutable</code> fallan: las filas de <code>ds-2026-08-01</code> no coinciden con su tarjeta. " + F("f1 detecta", filtro=r"en verde"),
          ["Alguien reescribió el manifest del padre.", "La tarjeta del padre está mal.", "Tu pipeline cambió algo del padre."],
          "python mundo/s3.py versiones ml-datos datasets/ds-2026-08-01/rows.parquet", F("f1 confirma"),
          "<code>rows.parquet</code> tiene dos versiones: la anterior tiene la huella de la tarjeta. Borra la vigente, la mala: <code>python mundo/s3.py borrar-version ml-datos datasets/ds-2026-08-01/rows.parquet &lt;version_id&gt;</code>. La buena vuelve a ser la vigente. Si la corrección era real, va como evento nuevo y entra al snapshot siguiente.",
          "versionado-bucket", "inmutable")
    falla("tarjeta-borrada", "El snapshot de septiembre no existe", "mundo",
          "El job de limpieza de staging/ tenía mal el prefijo y anoche corrió sobre datasets/: borra los .json «viejos». Salió en verde.",
          "<code>verificar.py</code>: <code>snapshot</code>, <code>corrida</code>, <code>lectura</code>, <code>inmutable</code> y <code>linaje</code> fallan: <code>ds-2026-09-01</code> no tiene tarjeta. " + F("f2 detecta", filtro=r"en verde"),
          ["Nunca se publicó.", "Alguien borró la tarjeta.", "El S3 no responde."],
          "python mundo/s3.py versiones ml-datos datasets/ds-2026-09-01/", F("f2 confirma"),
          "Con versionado, un DELETE sin version_id solo pone una <b>marca de borrado</b> encima. Bórrala: <code>python mundo/s3.py borrar-version ml-datos datasets/ds-2026-09-01/snapshot.json &lt;version_id de la marca&gt;</code>, y lo mismo con <code>validation.json</code>. No vuelvas a correr <code>5_publicar.py</code>: el PUT condicional solo mira la versión vigente, y si es una marca de borrado, pasa; escribirías una tarjeta nueva (otra hora, quizá otro commit) en vez de recuperar la original. En AWS, una política que niegue <code>s3:DeleteObject</code> en datasets/ lo habría impedido.",
          "tarjeta", "snapshot")
    falla("versiones-apagadas", "La factura bajó y nadie sabe por qué", "infra",
          "Plataforma revisó la factura de almacenamiento y «optimizó» los buckets de ML. Mandó un correo, pero se fue a spam.",
          "<code>verificar.py</code>: solo <code>inmutable</code> falla. " + F("f3 detecta", filtro=r"^✗"),
          ["Alguien apagó el versionado.", "El S3 perdió datos.", "Tu publicar ya no usa escritura condicional."],
          "python mundo/s3.py versionado ml-datos", F("f3 confirma"),
          "Préndelo otra vez: <code>python mundo/s3.py versionado ml-datos on</code>. Sin versiones, un PUT sin header reemplaza para siempre y un DELETE borra de verdad: no hay forma de deshacer. En S3, un bucket con versionado nunca vuelve a «sin versionado»: solo se suspende.",
          "versionado-bucket", "inmutable")
    falla("latest", "Ya no hay que editar params.yaml cada mes", "config",
          "Un compañero se cansó de cambiar el id del snapshot cada mes y dejó el entrenamiento «para que siempre agarre el más nuevo».",
          "<code>verificar.py</code>: <code>corrida</code>, <code>lectura</code> y <code>linaje</code> fallan. " + F("f4 detecta", filtro=r"^✗ corrida"),
          ["Alguien cambió params.yaml.", "La corrida se perdió.", "El snapshot desapareció."],
          "grep -n -A2 '^entrenar:' params.yaml\npython pipeline/6_entrenar.py", F("f4 confirma") + "\n" + F("f4 6_entrenar"),
          "<code>entrenar.snapshot</code> vuelve a ser el id: <code>ds-2026-09-01</code>. Un nombre que cambia de contenido no dice con qué se entrenó, y la caché de un orquestador vería la misma llave dos meses seguidos. Cambiar el id cada mes es trabajo del orquestador.",
          "parametro-no-carpeta", "corrida")
    falla("umbral-movido", "Más validación para medir mejor", "config",
          "Producto pidió medir con más ejemplos. Alguien subió la validación del 10 % al 20 % en params.yaml y dejó una nota: «solo es un número».",
          "<code>verificar.py</code>: <code>split</code> y <code>dag</code> fallan. " + F("f5 detecta", filtro=r"^✗ dag") + " Si corres <code>dvc repro</code>, la validación falla en <code>split_estable</code> y no se publica nada.",
          ["Alguien cambió un parámetro.", "Cambió la entrada.", "Cambió tu código."],
          "dvc status\ndvc repro", F("f5 confirma") + "\n" + F("f5 repro"),
          "<code>split.umbral</code> vuelve a 90 y <code>dvc repro</code>: DVC recupera de su caché la salida que ya tenía para esos parámetros. Si de verdad se quiere más validación, se logra con vendedores nuevos, nunca moviendo a los que ya estaban.",
          "split-estable", "dag")
    falla("labels-reentregados", "La estación 1 reentregó los labels de septiembre", "mundo",
          "La estación 1 avisó que el primer export de eventos de septiembre salió incompleto: faltaban 40 correcciones de moderación. Ya dejaron el archivo nuevo en entrada/.",
          "<code>verificar.py</code>: <code>labels</code> y <code>dag</code> fallan. " + F("f6 detecta", filtro=r"^✗ labels") + " Si corres <code>dvc repro</code>, todo pasa hasta publicar, y ahí S3 contesta 412.",
          ["Cambió una entrada del pipeline.", "Alguien tocó el snapshot publicado.", "Cambió tu código."],
          "dvc status\ndvc repro", F("f6 confirma") + "\n" + F("f6 repro"),
          "Que publicar falle es correcto: el snapshot publicado no se toca, porque la corrida que lo usó tiene que seguir siendo reproducible. El contenido nuevo lleva un id nuevo: en <code>params.yaml</code>, <code>snapshot.id</code> y <code>entrenar.snapshot</code> pasan a <code>ds-2026-09-01-r2</code>; git commit, <code>dvc repro</code> (publica r2 con parent <code>ds-2026-08-01</code>), git commit de <code>dvc.lock</code> y <code>python pipeline/6_entrenar.py</code>.",
          "snapshot", "dag")
    falla("foto-borrada", "Faltan fotos de una vendedora", "mundo",
          "Soporte atendió una solicitud de borrado de una vendedora y borró sus fotos del bucket del producto, como dice el proceso. A ML nadie le avisó.",
          "<code>verificar.py</code>: <code>lectura</code> falla. " + F("f7 detecta", filtro=r"^✗"),
          ["Se borraron fotos del bucket.", "Cambiaron las fotos bajo la misma llave.", "El snapshot apunta a llaves que nunca existieron."],
          "python pipeline/6_entrenar.py", F("f7 confirma"),
          "El snapshot no se reescribe: se anota el borrado. Busca las huellas que faltan (en <code>data/rows.parquet</code>, o mira dónde está cada una con <code>pipeline/7_linaje.py</code>), agrégalas a <code>entrada/borrados.csv</code> con la fecha de hoy en UTC y el motivo, corre <code>dvc repro</code> (split vuelve a correr y, como el registro se lee al corte, no cambia nada) y haz commit. El snapshot siguiente ya no las incluye; el modelo actual se decide aparte.",
          "registro-borrados", "lectura")
e["fallas"] = FAL

e["listo"] = [
    "Los labels del snapshot son los vigentes al corte, en UTC, con la regla de 30 días.",
    "Cada foto cuenta una vez, ninguna del golden set entra, y ningún vendedor cambió de lado contra el padre.",
    "El contrato de datos pasó antes de publicar, y si no hubiera pasado, nada se publicaba.",
    "<code>ds-2026-09-01</code> está en S3 con manifest, reporte y tarjeta, cada llave escrita una sola vez y con versionado.",
    "<code>dvc repro</code> corre solo lo que cambió, y <code>dvc.lock</code> está en un commit.",
    "Tu corrida guarda el id del snapshot, su huella, un commit limpio, la huella del entorno y la semilla.",
    "Desde una huella llegas a sus snapshots, a sus modelos y a su borrado.",
]

e["repaso"] = {
    "memo": "<b>Snapshot = manifest, no copia.</b> Un id inmutable que cita cada foto por llave y huella, una tarjeta que se escribe al final, y tres punteros desde cada modelo (snapshot y su huella, commit y entorno). Con eso, «¿con qué se entrenó?» se contesta en un minuto, y un contenido nuevo siempre lleva un id nuevo.",
    "trampa": "Inmutable «por convención». Sin escritura condicional y sin versiones, alguien reescribe el prefijo y el modelo de marzo deja de ser reproducible sin que nada truene. Y el versionado protege versiones, no llaves: un PUT nuevo a la misma llave pasa y es lo que se lee. Por eso la tarjeta guarda la huella y el modelo la comprueba.",
    "entrevista": [
        {"q": "¿Cómo sabes con qué datos se entrenó el modelo que está en producción?", "a": "La corrida guarda el id del snapshot y su rows_sha256. Leo la tarjeta del snapshot, recalculo la huella del manifest y la comparo: si coincide, el manifest me dice cada foto (llave + huella) y su label. Si el parámetro de la corrida fuera una ruta como latest, no lo sabría: por eso el id va como parámetro."},
        {"q": "¿Por qué un manifest en vez de copiar las fotos en cada versión?", "a": "Porque cita y no copia: en C01 un snapshot pesa ≈ 0.1 % de las fotos (≈ 97 MB contra ≈ 387 GB), así que guardar uno por mes cuesta centavos. El costo escondido es que depende de que las fotos sigan ahí: por eso cada fila lleva la huella, el entrenamiento la comprueba al leer y los borrados se anotan."},
        {"q": "¿Cómo evitas que alguien reescriba un snapshot publicado?", "a": "Tres capas: escritura condicional (If-None-Match: *, obligatoria por la política del bucket), versionado del bucket para recuperar lo que se pisó o se borró, y la huella en la tarjeta y en cada modelo, que delata cualquier cambio. Object Lock protege versiones, no llaves, así que no basta solo."},
        {"q": "Llegaron correcciones de labels de un mes que ya publicaste. ¿Qué haces?", "a": "No toco el snapshot publicado: la corrida que lo usó tiene que seguir siendo reproducible. Armo uno nuevo con otro id (aquí, ds-2026-09-01-r2), que pasa por el mismo contrato, y el siguiente entrenamiento apunta a él. Las correcciones son eventos nuevos, así que el corte decide qué entra."},
        {"q": "¿Por qué el split va por hash del vendedor y no al azar?", "a": "Por dos razones. Por vendedor, para que el modelo no reconozca la mesa o el fondo de alguien que vio en train. Por hash, para que sea estable: el mismo vendedor cae del mismo lado cada mes, y comparar el modelo nuevo contra el viejo es justo. Sortear cada mes movería ≈ 87,796 fotos de validación a train en C01."},
        {"q": "Alguien pide borrar sus fotos. ¿Cómo sabes en qué modelos están?", "a": "Busco sus huellas en los manifests de todos los snapshots y sigo las corridas que usaron esos snapshots. Las fotos se borran del bucket (todas sus versiones), sus huellas entran a un registro de borrados de solo agregar, el snapshot siguiente ya no las incluye y el entrenamiento las salta al leer. Qué pasa con el modelo actual se decide aparte."},
    ],
}

e["prompts"] = {
    "claude_md": "kits/c01-versionado/CLAUDE.md",
    "guiado": "content/estaciones/c01-versionado/prompts/guiado.md",
    "solo": "content/estaciones/c01-versionado/prompts/solo.md",
    "romper_ayuda": "content/estaciones/c01-versionado/prompts/romper-ayuda.md",
    "romper_solo": "content/estaciones/c01-versionado/prompts/romper-solo.md",
}

(APP / "content/estaciones/c01-versionado.json").write_text(json.dumps(e, ensure_ascii=False, indent=2) + "\n")
print("ok", len(json.dumps(e, ensure_ascii=False)))
