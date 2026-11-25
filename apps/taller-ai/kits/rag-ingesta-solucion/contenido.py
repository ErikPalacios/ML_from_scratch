"""Arma content/estaciones/rag-ingesta.json con las salidas reales de probar.sh y probar-fallas.sh.

    bash probar.sh /ruta/r1 && bash probar-fallas.sh /ruta/r1     # deja /ruta/r1.log y /ruta/r1-fallas.log
    python3 contenido.py /ruta/r1                                  # escribe el JSON con esas salidas

Ninguna salida se copia a mano: cada `salida` sale de una sección «### nombre» de los logs, y el código de cada
paso sale de los archivos de esta solución.
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
PROBAR = (SOL / "probar.sh").read_text()


def L(nombre: str, log: str = None, filtro=None, max_lineas=None, sin=None) -> str:
    log = LOG if log is None else log
    m = re.search(r"^### " + re.escape(nombre) + r"\n(.*?)(?=^### |\Z)", log, re.S | re.M)
    if not m:
        sys.exit(f"no está la sección «{nombre}»")
    lineas = m.group(1).rstrip("\n").splitlines()
    if filtro:
        lineas = [l for l in lineas if re.search(filtro, l)]
    if sin:
        lineas = [l for l in lineas if not re.search(sin, l)]
    if max_lineas:
        lineas = lineas[:max_lineas]
    return "\n".join(lineas).rstrip()


def F(nombre, **kw):
    return L(nombre, LOGF, **kw)


def P(nombre: str) -> str:
    """El comando tal como lo corre probar.sh en la sección «nombre» (para no escribirlo dos veces)."""
    m = re.search(r'^paso "' + re.escape(nombre) + r'" (.*?)(?=^paso |^usa |^rm |^#|^python mundo/fuentes.py parar|\Z)', PROBAR, re.S | re.M)
    if not m:
        sys.exit(f"no está el paso «{nombre}» en probar.sh")
    c = m.group(1).strip()
    if c.startswith("python -c \""):
        c = c.replace("\\\"", "\"")
    return c


def code(rel: str) -> str:
    return (SOL / rel).read_text().rstrip("\n")


def cmd(code_, salida, nota="", donde="mac"):
    return {"code": code_, "nota": nota, "donde": donde, "salida": salida}


def py(rel: str, nota: str = "") -> dict:
    return {"lang": "python", "path": rel, "code": code(rel), "nota": nota}


V = "python verificar.py"

e = {
    "id": "ingesta", "patron": "llm", "rama": "rag", "etapa": "datos", "num": 1,
    "titulo": "Conectores y parsing", "nav": "Conectores y parsing",
    "pregunta": "¿Cómo traes los documentos de cuatro fuentes distintas, con su texto limpio y sus permisos, sin volver a procesar lo que no cambió?",
    "version": "2026-11-25",
}

# ---------------------------------------------------------------- mapa
e["mapa"] = {
    "resumen": "Un RAG contesta con los documentos de la empresa, así que lo primero es <b>tenerlos</b>: traerlos de cada sistema donde viven, sacarles el texto y saber quién puede verlos. Esta estación es la <b>ingestión</b>. Un <b>conector</b> por fuente (una wiki, un Drive, un Jira y el repositorio de políticas) lista lo visible y trae lo que cambió; el <b>parsing</b> convierte HTML, PDF y tickets en texto limpio con su estructura; el texto se guarda <b>por el hash de su contenido</b>, así un documento que no cambió no se vuelve a procesar; y cada documento lleva su <b>ACL</b>, la lista de quién lo puede abrir. La estación 2 parte ese texto en chunks y la 3 lleva la ACL a cada chunk.",
    "entra": [
        "cuatro fuentes con su propia API: una wiki con páginas y restricciones, un Drive con PDFs y su feed de cambios, un Jira con tickets y niveles de seguridad, y un repositorio de políticas en Markdown",
        "una cuenta de servicio con un token por fuente, y el límite de llamadas de cada una",
        "un día después, las ediciones, borrados y cambios de permisos de ese día",
    ],
    "sale": [
        "el texto limpio de cada documento en <code>almacen/texto/&lt;sha256 del crudo&gt;.json</code>, guardado una vez por contenido",
        "el catálogo: por documento, su versión, su hash, su URL y su ACL como cláusulas de principals",
        "los cursores de cada conector, para que la siguiente corrida traiga solo lo nuevo",
        "un registro por corrida, con cuánto vio, descargó, parseó y saltó cada fuente",
    ],
    "escala": [
        {"que": "Documentos", "ref": "≈ 1.5 M: Confluence ≈ 375k páginas, Drive ≈ 620k archivos (≈ 300k PDFs), Jira ≈ 500k tickets de 2 años, políticas unos miles", "taller": "101 el día 1: wiki 27 páginas, Drive 16 archivos, Jira 50 tickets, políticas 8"},
        {"que": "Cambios al día", "ref": "≈ 1 % (≈ 15k documentos)", "taller": "17 cambios el día 2 (16 documentos vistos, 14 descargados, 11 parseados)"},
        {"que": "Frescura", "ref": "p95 ≤ 15 min de la edición a «responde con la versión nueva»; una revocación, ≤ 5 min (estación 3)", "taller": "lo que tardes en correr <code>pipeline/ingestar.py</code>: ≈ 1.5 s el día 2"},
        {"que": "Texto guardado", "ref": "≈ 19 GB de texto plano × ≈ 2 por estructura y metadatos ≈ 40 GB en S3 (≈ US$1 al mes)", "taller": "≈ 46 KB en 101 archivos de <code>almacen/texto/</code>"},
        {"que": "PDFs escaneados", "ref": "≈ 15 % de 300k PDFs × ≈ 10 páginas ≈ 450k páginas de OCR", "taller": "1 PDF escaneado, que se marca <code>necesita_ocr</code> (el dojo no hace OCR)"},
        {"que": "Dónde corre", "ref": "conectores, parsing y OCR en CPU (4 máquinas), con colas por fuente y el texto en S3", "taller": "un proceso en tu Mac: las fuentes en el puerto 8120 y el almacén en una carpeta"},
    ],
}

# ---------------------------------------------------------------- precálculos
e["precalculos"] = {
    "intro": "Antes de escribir un conector, las cuentas de servilleta de la ingestión: cuántos documentos hay, cuánto tarda el primer recorrido con el límite de llamadas, cuánto pesa el texto, cuánto cuesta el hash, cuánto cambia cada día, cuánto OCR hace falta y cuántos borrados de golpe son sospechosos. Cada cuenta va en las dos escalas: C11 y el dojo.",
    "cuentas": [
        {
            "id": "corpus", "pregunta": "¿Cuántos documentos hay que traer, y de qué fuentes?",
            "formula": "documentos = la suma, fuente por fuente, de lo que entra después de filtrar (sin papelera, sin archivados, solo el periodo útil)",
            "ref": {"cuenta": "375k páginas de Confluence + 620k archivos de Drive + 500k tickets de Jira (2 años) + unos miles de políticas", "valor": "≈ 1.5 M documentos, cada uno con su ACL"},
            "taller": {"cuenta": "27 páginas + 16 archivos + 50 tickets + 8 políticas", "valor": "101 documentos"},
            "decide": "Cuatro fuentes son cuatro conectores distintos: cada una tiene su API, su forma de avisar cambios y su modelo de permisos. El filtro de entrada (qué fuente, qué periodo) recorta más que cualquier optimización: Jira tiene ≈ 3 M tickets y solo entran los de 2 años.",
            "conceptos": ["ingestion", "conector"],
            "comprueba": cmd("python mundo/fuentes.py estado", L("pc corpus")),
        },
        {
            "id": "llamadas", "pregunta": "¿Cuánto tarda el primer recorrido de la wiki con su límite de llamadas?",
            "formula": "llamadas = páginas de la lista + documentos × llamadas por documento (cuerpo y restricción) + permisos de cada espacio; tiempo ≥ llamadas ÷ límite por segundo",
            "ref": {"cuenta": "≈ 375k páginas × 2 llamadas ≈ 750k llamadas (las de lista y de permisos de espacio suman menos de 5 %); con un límite de 10 por segundo (un supuesto: el número real lo acuerdas con quien administra la wiki)", "valor": "≥ 75,000 s ≈ 21 horas solo de wiki"},
            "taller": {"cuenta": "4 de lista + 27 cuerpos + 27 restricciones + 3 espacios = 61 llamadas ÷ 10 por segundo", "valor": "≥ 6.1 s"},
            "decide": "El primer recorrido (el crawl inicial) se reparte en días y por prioridad, y cada llamada que ahorras cuenta: guarda en memoria la restricción de cada ancestro, porque la comparten muchas páginas. Y un 429 no es un error: es la fuente pidiéndote que esperes.",
            "conceptos": ["rate-limit", "paginacion"],
            "comprueba": cmd(P("pc llamadas"), L("pc llamadas")),
            "confirma": "el paso 7: la primera corrida de la wiki hizo 67 llamadas (61 más 6 reintentos por 429) en ≈ 6.5 s.",
        },
        {
            "id": "texto", "pregunta": "¿Cuánto pesa guardar el texto parseado de todo?",
            "formula": "texto = tokens del corpus × ≈ 4 bytes por token; guardado ≈ texto × 2 por la estructura y los metadatos",
            "ref": {"cuenta": "≈ 4.8 B tokens × 4 B ≈ 19 GB de texto; × 2 ≈ 40 GB en S3 (a ≈ US$0.023 por GB al mes en S3 Standard)", "valor": "≈ US$1 al mes"},
            "taller": {"cuenta": "73 KiB de contenido crudo (HTML, PDF, JSON y Markdown) → el texto limpio", "valor": "46,568 bytes en 101 archivos"},
            "decide": "Guardar el texto parseado cuesta casi nada y te ahorra lo caro: si mañana cambia el chunking o el modelo de embeddings, vuelves a partir desde el almacén, sin volver a llamar a las APIs (con sus límites) ni repetir el OCR.",
            "conceptos": ["hash-contenido"],
            "comprueba": cmd(P("pc crudo"), L("pc crudo")),
            "confirma": "el paso 7: <code>almacen/texto/</code> tiene 101 archivos y 46,568 bytes.",
        },
        {
            "id": "hash", "pregunta": "¿Cuánto cuesta calcular el hash de todo el contenido?",
            "formula": "tiempo = bytes de contenido ÷ velocidad de sha256 en un núcleo",
            "ref": {"cuenta": "≈ 19 GB de texto ÷ ≈ 1.4 GB/s (lo que mide tu Mac); el crudo pesa más (PDFs), digamos 10 veces: ≈ 190 GB ÷ 1.4 GB/s", "valor": "≈ 14 s para el texto; ≈ 2.3 min de un núcleo para el crudo"},
            "taller": {"cuenta": "73 KiB ÷ 1.4 GB/s", "valor": "≈ 55 µs: lo que tarda es la red, no el hash"},
            "decide": "Hashear todo es gratis comparado con parsear o hacer OCR: no hay razón para volver a parsear un contenido cuyo hash ya tienes. El hash va sobre los bytes crudos, tal como llegan.",
            "conceptos": ["hash-contenido"],
            "comprueba": cmd(P("pc hash"), L("pc hash"), "En una M4. 1.3 GiB/s son ≈ 1.4 GB/s. Tu número puede variar (en otra corrida salió 1.2)."),
        },
        {
            "id": "cambios", "pregunta": "Si solo traes lo que cambió, ¿cuánto procesas cada día?",
            "formula": "por día = documentos × fracción que cambia; ahorro = documentos ÷ cambios del día",
            "ref": {"cuenta": "1.5 M × 1 % = ≈ 15k documentos al día, contra 1.5 M si reprocesas todo cada noche", "valor": "≈ 100 veces menos trabajo (y respuestas de minutos, no de 24 horas)"},
            "taller": {"cuenta": "el día 2 cambian 17 cosas en 103 documentos: 14 se descargan y, de esos, 3 traen los mismos bytes", "valor": "11 parseados en lugar de 103"},
            "decide": "La corrida incremental lee desde un cursor, y el hash ahorra un escalón más: un cambio de permisos, un nombre nuevo o una republicación idéntica bajan el archivo, pero no se vuelven a parsear.",
            "conceptos": ["cursor", "hash-contenido"],
            "confirma": "el paso 8: el día 2, la corrida vio 16, descargó 14, parseó 11 y saltó 3 por hash.",
        },
        {
            "id": "ocr", "pregunta": "¿Cuántas páginas necesitan OCR, y cuánto cuesta?",
            "formula": "páginas = PDFs × fracción escaneada × páginas por PDF; costo = páginas × segundos de CPU por página",
            "ref": {"cuenta": "300k PDFs × ≈ 15 % × ≈ 10 páginas = ≈ 450k páginas × ≈ 2 s por página en un núcleo", "valor": "≈ 250 núcleo-horas, una vez; después solo lo nuevo"},
            "taller": {"cuenta": "1 PDF escaneado de 2 páginas, de 10 PDFs", "valor": "0 en el dojo: se marca <code>necesita_ocr</code> y no entra con texto vacío"},
            "decide": "Un PDF escaneado sin OCR es un documento vacío: si lo indexas así, nadie lo encuentra y nadie se entera. Se detecta (casi no tiene texto extraíble), se marca y se cuenta, y el OCR corre aparte, una sola vez por contenido.",
            "conceptos": ["ocr"],
            "confirma": "el paso 5: el acta de inventario escaneada sale con texto vacío y <code>necesita_ocr: True</code>.",
        },
        {
            "id": "freno", "pregunta": "¿Cuántos borrados de golpe son sospechosos?",
            "formula": "límite = documentos vivos de la fuente × fracción máxima de borrado en una pasada",
            "ref": {"cuenta": "Drive: 620k × 2 %", "valor": "≈ 12k documentos: más que eso en una pasada casi siempre es una credencial o un permiso, no 12k borrados de verdad"},
            "taller": {"cuenta": "Drive: 15 vivos el día 2 × 20 % (con 15 documentos, el 2 % sería menos de uno)", "valor": "3 documentos; perder la unidad compartida quiere borrar 11 (73 %) y se frena"},
            "decide": "El barrido borra lo que ya no ve (fail-closed), y el freno evita que un permiso roto vacíe una fuente entera. Cuando se frena, se arregla el acceso, no el catálogo.",
            "conceptos": ["freno", "barrido"],
            "confirma": "el paso 8 y la falla «unidad-perdida»: el barrido quería borrar 11 de 15 y no borró nada.",
        },
    ],
}

# ---------------------------------------------------------------- conceptos
C = lambda id_, termino, en, def_, analogia, importa, trampa: dict(id=id_, termino=termino, en=en, def_=def_, analogia=analogia, importa=importa, trampa=trampa)  # noqa: E731
conceptos = [
    C("ingestion", "Ingestión", "ingestion",
      "Traer los documentos desde donde viven, convertirlos en texto y guardarlos con sus datos (versión, permisos, origen), y mantenerlos al día.",
      "Como la recepción de una biblioteca: recibe libros de varias editoriales, les pone su ficha y su sello de quién puede pedirlos, y los acomoda. Si la recepción falla, el mejor bibliotecario no encuentra nada.",
      "En un RAG casi nada se entrena: el LLM y los embeddings vienen hechos. Lo que decide si la respuesta es buena es lo que entró: el texto correcto, completo, al día y con sus permisos.",
      "Pensar que es «copiar archivos una vez». La ingestión es continua: cada día hay ediciones, borrados y cambios de permisos, y todos tienen que llegar."),
    C("conector", "Conector y cuenta de servicio", "connector · service account",
      "El código que habla con una fuente (su API, su paginación, sus permisos) con una cuenta de servicio: un usuario técnico, con su token, que solo lee.",
      "Un mensajero por cada oficina: cada una tiene su ventanilla, sus horarios y su forma de pedir las cosas. El mensajero lleva su credencial (el token) y sabe cómo pedir en esa ventanilla.",
      "Cada fuente es un proyecto aparte: otra API, otra manera de avisar cambios y otro modelo de permisos. Por eso los conectores comparten una forma (listar, cambios, traer, acl) y el resto del pipeline no sabe de qué fuente viene un documento.",
      "Tratar un 401 o un 403 como «no hay nada». Un conector con el token vencido se ve exactamente como uno sin cambios: por eso el error se lanza y se cuenta."),
    C("paginacion", "Paginación", "pagination",
      "Una API no te da 10,000 resultados de una vez: te da una página (10 o 20) y un enlace o token para pedir la siguiente, hasta que ya no hay.",
      "Un catálogo impreso por tomos: terminas el tomo 1 y en la última hoja dice «sigue en el tomo 2». Si no lo abres, crees que el catálogo era de un tomo.",
      "Cada fuente pagina distinto: la wiki del dojo con «siguiente», el Drive con <code>nextPageToken</code>, el Jira con <code>nextPageToken</code> e <code>isLast</code>. Si te quedas con la primera página, pierdes documentos sin ningún error.",
      "Calcular las páginas con «total ÷ tamaño» y un contador: si alguien crea o borra algo mientras recorres, saltas o repites. Sigue el enlace o el token que te da la API."),
    C("rate-limit", "Límite de llamadas", "rate limit · 429 · Retry-After",
      "Cuántas llamadas por segundo te deja hacer una API. Si te pasas responde 429 (Too Many Requests), casi siempre con Retry-After: cuánto esperar (en segundos o, según el estándar, una fecha).",
      "La fila de una taquilla con un letrero «máximo 10 personas por segundo»: si llegas antes, el guardia te dice «espera unos segundos». Insistir no te hace pasar antes.",
      "El crawl inicial de C11 se mide en horas o días por este límite. Un conector respeta Retry-After y reintenta un número acotado de veces; así la corrida tarda más, pero termina.",
      "Quitar los reintentos «para que no se quede esperando»: el primer 429 tumba la corrida a la mitad. O reintentar sin esperar, que solo te gana más 429."),
    C("acl", "ACL y principals", "access control list · principals",
      "La lista de quién puede abrir un documento. Cada entrada es un principal: un usuario (<code>user:ana@…</code>), un grupo (<code>group:soporte@…</code>) o todo el dominio (<code>domain:…</code>).",
      "La lista de invitados en la puerta de una fiesta: puede decir nombres («Ana») o grupos («el equipo de soporte»). El guardia no necesita saber quién está en cada grupo ahora; eso se resuelve cuando alguien llega.",
      "Un RAG empresarial no puede contestar con un documento que tú no podrías abrir. Para filtrar en la búsqueda (estación 3), cada documento tiene que traer su ACL desde la ingestión.",
      "Guardar la lista de usuarios ya «expandida» en vez de los grupos: cada alta o baja en un grupo grande obligaría a reescribir miles de documentos."),
    C("clausulas", "Cláusulas: un AND de ORs", "ACL clauses",
      "Una ACL como lista de cláusulas: cada cláusula es un OR de principals, y para ver el documento tienes que cumplir TODAS (AND).",
      "Entrar a una sala dentro de un edificio: necesitas el gafete del edificio Y estar en la lista de esa sala. Tener uno solo no alcanza.",
      "Así se representan permisos que se suman: espacio de la wiki ∧ restricción del ancestro ∧ restricción de la página, o proyecto de Jira ∧ nivel de seguridad. Una lista plana dejaría ver la página restringida a quien solo ve el espacio.",
      "Juntar todos los principals en una sola lista «por simplicidad»: convierte un AND en un OR y abre lo que estaba restringido."),
    C("herencia", "Restricción heredada", "inherited restrictions",
      "En la wiki, una restricción de lectura en una página también cierra todas las páginas debajo de ella, aunque esas no tengan restricción propia.",
      "Una carpeta con candado en un archivero: las hojas de adentro no tienen candado propio, pero nadie las saca sin abrir la carpeta.",
      "La API de la wiki del dojo (como la de Confluence) te da solo la restricción PROPIA de cada página. Si no recorres los ancestros, «Caso Transportes del Norte» queda visible para todo Legal en vez de solo para litigios.",
      "Leer solo la restricción de la página y dar por buena una lista vacía: la página hija de una restringida sale abierta."),
    C("link-compartido", "Link compartido", "link sharing · allowFileDiscovery",
      "En Drive, «cualquiera con el link» es un permiso <code>anyone</code> o <code>domain</code> con <code>allowFileDiscovery: false</code>: lo abre quien tiene el link, pero no aparece en búsquedas.",
      "Dejar la llave de tu casa con tres amigos: no es lo mismo que pegarla en la puerta del edificio. Quien tiene la llave entra; los demás ni saben que existe.",
      "Regla del caso: link compartido = no compartido. Si lo indexas como visible para todo el dominio, el asistente convierte cada link en un documento que cualquiera encuentra preguntando (como el tabulador de sueldos).",
      "Tomar el campo <code>type</code> y olvidar <code>allowFileDiscovery</code>. O «ampliarlo» por pedido de producto sin pasar por Seguridad."),
    C("cursor", "Cursor de cambios", "change cursor · page token",
      "Lo que el conector guarda para la siguiente corrida: hasta dónde leyó. Una fecha (la wiki, el Jira), un token del feed de cambios (el Drive) o las huellas de un árbol (las políticas).",
      "El separador que dejas en un libro: mañana abres ahí, no desde la primera página.",
      "Es lo que hace incremental a la ingestión: el día 2 se traen 14 documentos, no 103. Se guarda solo si la fuente terminó bien; si se cae a la mitad, la siguiente corrida vuelve a empezar desde el cursor viejo.",
      "Pedir el token de inicio del Drive DESPUÉS de listar: lo que cambió mientras listabas queda fuera para siempre. O usar la hora de tu Mac en vez de las fechas de la fuente."),
    C("idempotencia", "Idempotencia", "idempotency",
      "Procesar dos veces lo mismo deja el mismo resultado que procesarlo una vez: nada se duplica ni se pisa.",
      "El botón del elevador: picarlo cinco veces no trae cinco elevadores.",
      "Te permite traer de más sin miedo: el JQL de Jira solo entiende minutos, así que lo que cayó en el minuto del cursor vuelve a salir, y con la versión igual cuenta como «sin cambios». Los reintentos y las corridas repetidas tampoco rompen nada.",
      "Intentar traer «exactamente lo nuevo» con un corte al segundo y perder lo que cayó en el mismo minuto, en vez de traer un poco de más y dejar que la versión decida."),
    C("parsing", "Parsing", "parsing",
      "Convertir el contenido crudo (HTML, PDF, el JSON de un ticket) en texto limpio que conserva la estructura: títulos, listas y tablas.",
      "Pasar en limpio unas notas: copias lo que importa, respetas los títulos y las tablas, y no copias los tachones ni el membrete de cada hoja.",
      "El LLM solo ve el texto que le das. Si el parser mezcla menús, pierde títulos o aplana una tabla, ningún modelo arregla después lo que no llegó.",
      "Un parser genérico para todo («extrae el texto del archivo»): cada formato tiene su basura y su estructura, y se parsea distinto."),
    C("boilerplate", "Boilerplate", "boilerplate",
      "El texto que se repite y no es contenido: menús de navegación, pies de página, encabezados de cada hoja de un PDF, firmas de correo, mensajes automáticos.",
      "El membrete y el «página 2 de 3» de cada hoja de una carta: están en todas, y no dicen nada de la carta.",
      "Si entra al índice, ensucia la búsqueda: «Ver historial» aparece en las 27 páginas y no ayuda a ninguna pregunta. En un PDF, el encabezado repetido se detecta porque está en TODAS las páginas.",
      "Borrar «lo que se parece a un pie» con una lista fija de frases: cambia el formato y se cuela. Mejor una regla de estructura (div.nav, la línea que se repite en cada página)."),
    C("tabla-filas", "Tabla como filas", "tables as rows",
      "Cada fila de una tabla se escribe con su encabezado: «Categoría: Electrónica; Comisión: 8 %».",
      "Leer un horario de autobús en voz alta: no dices «Centro Norte Sur 8:00 8:15 8:30», dices «al Centro a las 8:00, al Norte a las 8:15».",
      "«¿Qué comisión paga Electrónica?» tiene la respuesta en una celda. Si el parser aplana la tabla a texto corrido, se pierde qué número va con qué categoría y el LLM contesta con seguridad el número equivocado.",
      "Dejar que el extractor de texto «lea» la tabla de izquierda a derecha: sale una sopa de valores sin encabezados."),
    C("ocr", "Capa de texto y OCR", "text layer · OCR",
      "Un PDF digital trae el texto adentro (su capa de texto). Uno escaneado es solo una imagen: sacarle el texto pide OCR (reconocimiento óptico de caracteres).",
      "Un libro contra la fotocopia de un libro: del primero copias y pegas; de la fotocopia, alguien tiene que volver a teclear lo que ve.",
      "pypdf solo lee la capa de texto: de un escaneo saca casi nada. Si no lo detectas, entra un documento vacío. En C11, ≈ 450k páginas van por OCR una vez y después solo lo nuevo.",
      "Confiar en que «si es PDF tiene texto». O indexar el escaneo con texto vacío y no contarlo en ningún lado."),
    C("hash-contenido", "Direccionado por contenido", "content addressing · content hash",
      "Guardar cada contenido con el sha256 de sus bytes como nombre. El mismo contenido siempre da el mismo nombre; un byte distinto da otro.",
      "Las huellas digitales: no importa cómo se llame la persona hoy ni dónde esté; si la huella coincide, es la misma.",
      "Si el hash del crudo ya está en el almacén (y se parseó con el parser de hoy), no se vuelve a parsear: un cambio de permisos, de nombre o una republicación idéntica no cuestan parsing ni OCR. Y dos copias iguales se guardan una vez.",
      "Usar como llave la fecha de modificación o el nombre del archivo: cambian sin que cambie el contenido, y al revés. O hashear el texto ya parseado: entonces cada vez tienes que parsear para saber si cambió."),
    C("barrido", "Barrido de reconciliación", "reconciliation sweep",
      "Una pasada que lista TODO lo que la fuente deja ver y lo compara con el catálogo: lo que ya no está se borra, lo de otra versión se reprocesa y las ACL se vuelven a leer.",
      "Hacer inventario de la bodega aunque tengas las notas de entrada y salida: las notas se pierden; el conteo físico dice la verdad.",
      "Los eventos y los cursores son para la latencia; el barrido es para la verdad. La wiki no avisa borrados ni cambios de permisos: el día 2, la macro borrada y la restricción nueva solo las encuentra el barrido.",
      "Confiar solo en la corrida incremental. Lo que nunca te avisaron (un borrado, una restricción) se queda en el catálogo para siempre."),
    C("fail-closed", "Fail-closed y lápidas", "fail-closed · tombstone",
      "Ante la duda, cerrar: lo que el conector ya no puede leer se quita. Y no se borra el registro: queda una lápida con su motivo y su fecha.",
      "Un banco que, si el lector de huellas falla, no abre la bóveda «mientras lo arreglan». Y el registro de quién salió y por qué no se tira: se archiva.",
      "Si alguien restringe una página a «solo yo», la cuenta del conector también la pierde y nadie te avisa: si sigues sirviéndola, el asistente muestra lo que ya no debería. La lápida deja rastro de qué se quitó y cuándo.",
      "Tratar un 404 o un 403 de la fuente como «reintenta luego y mientras tanto sigue sirviendo». O borrar el registro sin rastro."),
    C("freno", "Freno de borrado", "deletion circuit breaker",
      "Si una pasada quiere borrar más de cierta fracción de una fuente (2 % en C11, 20 % en el dojo), no borra nada y avisa.",
      "El límite de retiro de tu tarjeta: si alguien intenta sacar todo de golpe, el banco lo detiene y te llama, aunque podría ser legítimo.",
      "Un permiso perdido o un token vencido hacen que media fuente «desaparezca». Sin freno, el barrido borra medio Drive del índice por un problema de acceso, y lo notas cuando nadie encuentra nada.",
      "Ponerlo tan alto que nunca salta, o «arreglar» el freno borrando a mano: lo que se arregla es el acceso."),
]
for c in conceptos:
    c["def"] = c.pop("def_")
e["conceptos"] = conceptos

# ---------------------------------------------------------------- el kit
e["mundo"] = {
    "resumen": "El kit trae el marketplace del caso en chico, el 20 de noviembre de 2026: <b>cuatro fuentes de documentos ficticios</b> (una wiki con 27 páginas en 3 espacios, un Drive con 16 archivos, un Jira con 50 tickets y un repositorio con 8 políticas) servidas por HTTP en tu Mac, cada una con su API, su paginación, su forma de avisar cambios y sus permisos. Tú escribes la ingestión: los conectores, el parsing, el almacén por hash y la corrida incremental. Después pasa un día y ves qué trae tu ingestión. Sin Docker, sin GPU y sin internet (después del <code>pip install</code>).",
    "trae": [
        {"que": "mundo/fuentes.py", "detalle": "Las cuatro APIs en el puerto 8120: la wiki (con un límite de 10 llamadas por segundo y 429), el Drive (con su feed de cambios y sus permisos), el Jira (con un JQL chico, fechas en la zona de la cuenta y niveles de seguridad) y el repositorio de políticas (un árbol con el sha de git de cada archivo). Todas piden un token. También hace de administrador: <code>token</code>, <code>unidad</code>, <code>log</code> y <code>estado</code>."},
        {"que": "mundo/crear.py y mundo/avanzar.py", "detalle": "El día 1 (101 documentos, siempre iguales: sin azar y sin descargas) y el día 2, con 17 cambios: ediciones, una republicación idéntica, borrados, una página nueva dentro de una restringida, un permiso nuevo sin versión nueva, un archivo que solo cambia de nombre y tickets nuevos."},
        {"que": "Los documentos", "detalle": "Páginas de la wiki con menú, macro de índice, pie y tablas; PDFs reales (los escribe <code>mundo/pdf.py</code>) con encabezado y pie en cada hoja, y uno escaneado sin capa de texto; tickets con firma, correos citados y comentarios automáticos; políticas en Markdown. Hay una página restringida que hereda su restricción, un PDF compartido solo «con el link» y tickets con nivel de seguridad."},
        {"que": "pipeline/_comun.py y config.yaml", "detalle": "Lo que comparten los pasos (<code>config()</code>, <code>sha256()</code>, <code>utc()</code>, <code>escribir_json()</code> de un jalón, <code>FuenteSinAcceso</code>) y la configuración: URLs, tokens, reintentos, la zona del Jira, la regla del link compartido y el freno."},
        {"que": "verificar.py y romper.py", "detalle": "11 checks con los criterios de «listo» (los de los conectores llaman a tu código contra las fuentes; los del almacén comparan con la verdad del mundo, <code>mundo/referencia.py</code>) y 6 fallas en el mundo, la configuración o el almacén, nunca en lo que escribes."},
    ],
    "tu_pipeline": [
        {"archivo": "pipeline/conectores/http.py", "hace": "<code>pedir()</code>: token, reintentos ante 429 con Retry-After, 401/403 → FuenteSinAcceso, 404 → None."},
        {"archivo": "pipeline/conectores/wiki.py", "hace": "Las páginas paginadas y la ACL como espacio ∧ ancestros ∧ página."},
        {"archivo": "pipeline/conectores/drive.py", "hace": "El feed de cambios con su pageToken y los permisos, con link compartido = no compartido."},
        {"archivo": "pipeline/conectores/jira.py", "hace": "El JQL por fecha, en minutos y en la zona de la cuenta, y la ACL por proyecto y nivel de seguridad."},
        {"archivo": "pipeline/conectores/politicas.py", "hace": "El árbol de git contra el cursor: nuevos, cambiados y borrados por su sha."},
        {"archivo": "pipeline/parsing.py", "hace": "HTML, PDF, ticket y Markdown a texto limpio, con títulos, listas y tablas fila por fila; detecta el escaneo."},
        {"archivo": "pipeline/almacen.py", "hace": "El texto por el hash del crudo, el catálogo con la ACL y las lápidas."},
        {"archivo": "pipeline/ingestar.py", "hace": "La corrida incremental (procesar e incremental) y el barrido con su freno. La línea de comandos y el resumen vienen dados."},
    ],
    "requisitos": [
        "Python 3.11 o más nuevo (se probó con 3.14.3) y ≈ 30 MB para el entorno virtual",
        "El puerto 8120 libre en tu Mac",
        "Internet solo para el <code>pip install</code> (beautifulsoup4, pypdf y pyyaml)",
    ],
    "sustituciones": [
        {"nube": "Confluence Cloud (API REST)", "local": "La wiki del dojo, <code>/wiki/api</code>", "diferencia": "La misma idea: páginas paginadas, el cuerpo en HTML, permisos del espacio y restricciones de lectura propias de cada página, que se heredan a las de abajo (solo las de lectura; las de edición no se heredan), y 429 con Retry-After. Las rutas y los campos del dojo son más chicos; en Confluence el cuerpo viene en su formato de almacenamiento, con macros, y los cambios se avisan con eventos para apps (webhooks) o se consultan por fecha."},
        {"nube": "Google Drive API v3", "local": "El Drive del dojo, <code>/drive/v3</code>", "diferencia": "Imita la forma: <code>changes/startPageToken</code>, <code>changes</code> con <code>nextPageToken</code> o <code>newStartPageToken</code>, <code>files/&lt;id&gt;?alt=media</code> y la lista de permisos con <code>type</code> (user, group, domain, anyone) y <code>allowFileDiscovery</code>. En Drive, <code>anyone</code> con <code>allowFileDiscovery: true</code> es público y buscable; el dojo lo trata como todo el dominio, por la regla del caso. El de Google tiene unidades compartidas con su propia herencia, carpetas de acceso limitado (<code>inheritedPermissionsDisabled</code>) y notificaciones push; aquí, una unidad que se puede perder."},
        {"nube": "Jira Cloud (API REST y JQL)", "local": "El Jira del dojo, <code>/jira/api</code>", "diferencia": "La búsqueda pagina con <code>nextPageToken</code> e <code>isLast</code>, y el JQL entiende fechas al minuto en la zona del perfil de quien consulta, como el de Atlassian. En Jira Cloud la API v3 devuelve la descripción en ADF (un JSON con estructura), no en texto plano; el JQL del dojo solo acepta proyecto, <code>updated &gt;=</code> y el orden."},
        {"nube": "El repositorio de políticas (git)", "local": "<code>/repo/politicas/arbol</code> y <code>/crudo</code>", "diferencia": "El sha de cada archivo es el de git (sha1 de «blob &lt;tamaño&gt;\\0» y el contenido), así que la huella la da la fuente. En C11 los cambios llegan por los commits del repositorio."},
        {"nube": "Un bucket de S3 con el JSON estructurado de cada versión", "local": "La carpeta <code>almacen/</code>", "diferencia": "Los mismos archivos direccionados por hash; S3 agrega versionado, permisos y durabilidad."},
        {"nube": "Un parser de layout y OCR (por ejemplo Docling, de licencia MIT)", "local": "pypdf, que solo lee la capa de texto", "diferencia": "Un parser de layout reconoce orden de lectura, columnas y tablas dentro del PDF; pypdf saca líneas sueltas y no hace OCR. Por eso el escaneo se marca y no se procesa."},
        {"nube": "Colas por fuente, webhooks y un orquestador", "local": "Una corrida a mano de <code>pipeline/ingestar.py</code>", "diferencia": "En C11 la ingestión corre sola y sin parar; aquí la corres tú, una vez por «día», y ves cada cuenta."},
    ],
    "arranque": "unzip rag-ingesta.zip && cd rag-ingesta\npython3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt\npython mundo/crear.py\npython mundo/fuentes.py arrancar",
    "python": "python",
}

# ---------------------------------------------------------------- guiado
G = []
G.append(dict(n=0, id="mundo", titulo="Levantar el mundo", objetivo="Las cuatro fuentes arriba en el puerto 8120, con el mundo del día 1.",
    conceptos=["ingestion"],
    explica="El mundo vive en <code>fuentes/estado.json</code> (lo escribe <code>mundo/crear.py</code>, siempre igual) y lo sirve <code>mundo/fuentes.py</code> por HTTP, en segundo plano. Tu ingestión solo habla con esas APIs, como lo haría con las de verdad.",
    codigo=[],
    comandos=[
        cmd("python3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt", L("p0 venv"), "Desde aquí, cada terminal nueva necesita <code>source .venv/bin/activate</code>."),
        cmd("python mundo/crear.py\npython mundo/fuentes.py arrancar", L("p0 crear") + "\n" + L("p0 arrancar")),
        cmd(f"{V} mundo", L("p0 verificar")),
        cmd(f"{V} http", L("p0 esqueleto"), "Es lo esperado: <code>pipeline/</code> todavía es el esqueleto. Cada check se pone en verde en su paso."),
    ],
    verifica="<code>verificar.py mundo</code> en verde.",
    ojo="Si el 8120 está ocupado, <code>lsof -nP -iTCP:8120 -sTCP:LISTEN</code> te dice quién. Las fuentes siguen corriendo aunque cierres la terminal: <code>python mundo/fuentes.py parar</code> las apaga."))

G.append(dict(n=1, id="pedir", titulo="Una llamada que no se traga los errores", objetivo="<code>pedir()</code>: el token en cada llamada, esperar y reintentar ante un 429, y nunca convertir un 401 en «vacío».",
    conceptos=["conector", "rate-limit"],
    explica="Las cuatro fuentes se piden igual: GET a una URL, con el encabezado <code>Authorization: Bearer &lt;token&gt;</code> de la cuenta de servicio. Lo que cambia es qué haces con la respuesta. <b>200</b>: el JSON como dict o, si es un PDF o un Markdown, los bytes. <b>429</b>: la fuente te pide esperar; <code>Retry-After</code> dice cuántos segundos, y reintentas hasta <code>http.reintentos</code> veces. <b>401 o 403</b>: <code>FuenteSinAcceso</code>, que la corrida anota y no esconde. <b>404</b>: None, porque el documento ya no existe o ya no lo puedes ver. Cuentas cada llamada y cada 429: son los números del precálculo de llamadas.",
    codigo=[py("pipeline/conectores/http.py")],
    comandos=[
        cmd(P("p1 pedir"), L("p1 pedir"), "20 llamadas seguidas a la wiki: la cubeta deja 10 de golpe y ≈ 10 por segundo después, así que alguna recibe 429 y se reintenta."),
        cmd(P("p1 401"), L("p1 401"), "Lo que contesta una fuente con un token que no sirve. Tu <code>pedir()</code> lo convierte en <code>FuenteSinAcceso</code>."),
        cmd(f"{V} http", L("p1 verificar")),
    ],
    verifica="<code>verificar.py http</code> en verde: JSON → dict, bytes → bytes, 404 → None, 401 → FuenteSinAcceso y 25 llamadas a la wiki sin perder ninguna.",
    ojo="<code>urlopen</code> lanza <code>HTTPError</code> para cualquier código ≥ 400: el 429 y el 404 también llegan como excepción, no como respuesta.",
    en_pagina={"conceptos": ["ingestion", "conector", "rate-limit"], "precalculos": ["corpus", "llamadas"]}))

G.append(dict(n=2, id="wiki", titulo="El conector de la wiki", objetivo="Todas las páginas de los 3 espacios, siguiendo la paginación, y la ACL de cada una como espacio ∧ ancestros ∧ página.",
    conceptos=["paginacion", "acl", "clausulas", "herencia"],
    explica="Los cuatro conectores tienen la misma forma (está en <code>pipeline/conectores/__init__.py</code>): <code>listar()</code>, <code>cambios(cursor)</code>, <code>traer(ref)</code> y <code>acl(ref)</code>. Un <b>ref</b> es lo que sabes de un documento sin bajarlo (id, versión, fecha, título); un <b>doc</b> es el ref más su contenido crudo y su ACL. La wiki da 10 páginas por llamada y en «siguiente» la ruta de las que siguen. Su ACL es una <b>intersección</b>: quien puede ver el espacio, y además quien está en la restricción de cada ancestro restringido y de la página. La API solo te da la restricción propia de cada página, así que recorres los ancestros (vienen en la lista) y guardas cada restricción en memoria: muchas páginas comparten ancestros y cada llamada cuenta para el límite.",
    codigo=[py("pipeline/conectores/wiki.py")],
    comandos=[
        cmd(P("p2 lista"), L("p2 lista")),
        cmd(P("p2 restricciones"), L("p2 restricciones"), "«Caso Transportes del Norte» (3004) no tiene restricción propia; su padre, «Litigios» (3003), sí."),
        cmd(P("p2 acl"), L("p2 acl"), "3004 hereda la cláusula de 3003: para verla hay que ver el espacio Legal Y estar en litigios."),
        cmd(f"{V} wiki", L("p2 verificar")),
    ],
    verifica="<code>verificar.py wiki</code> en verde: las 27 páginas, cada una con su versión y su ACL.",
    ojo="La versión va como texto (<code>\"3\"</code>), igual en todas las fuentes: así el catálogo compara versiones sin saber de qué fuente vienen.",
    en_pagina={"conceptos": ["paginacion", "acl", "clausulas", "herencia"], "precalculos": []}))

G.append(dict(n=3, id="drive", titulo="El conector del Drive", objetivo="El feed de cambios con su pageToken, y los permisos de cada archivo con la regla del link compartido.",
    conceptos=["cursor", "link-compartido"],
    explica="El Drive no se recorre por fecha: tiene un <b>feed de cambios</b>. Pides un token de inicio (<code>startPageToken</code>) y, la vez siguiente, todo lo que cambió desde ese token, página por página, hasta que la respuesta trae <code>newStartPageToken</code>: ese es tu cursor nuevo. La primera vez, el orden importa: <b>primero el token, después la lista</b>, así lo que cambie mientras listas queda en el feed. Un cambio con <code>removed: true</code> (ya no lo ves) o con el archivo en la papelera es un borrado. La ACL es una sola cláusula con los permisos del archivo: usuarios y grupos tal cual, y <code>domain</code> o <code>anyone</code> solo si son <b>descubribles</b>; un link compartido no da acceso a nadie.",
    codigo=[py("pipeline/conectores/drive.py")],
    comandos=[
        cmd(P("p3 permisos"), L("p3 permisos"), "d04 (los sueldos) se compartió con «cualquiera con el link»; d09, con el link dentro del dominio."),
        cmd(P("p3 acl"), L("p3 acl"), "d01 y d10 sí son de todo el dominio (descubribles). d04 queda solo para su dueña y d09 para operaciones."),
        cmd(f"{V} drive", L("p3 verificar")),
    ],
    verifica="<code>verificar.py drive</code> en verde: los 16 archivos, el cursor es el startPageToken y desde el token 0 salen todos una sola vez.",
    ojo="Un archivo que cambió dos veces sale dos veces en el feed: quédate con el estado más nuevo, una vez.",
    en_pagina={"conceptos": ["cursor", "link-compartido"], "precalculos": []}))

G.append(dict(n=4, id="jira-politicas", titulo="Los conectores del Jira y de las políticas", objetivo="El JQL por fecha en la zona de la cuenta, la ACL por proyecto y nivel de seguridad, y el árbol de git de las políticas.",
    conceptos=["idempotencia", "cursor", "clausulas"],
    explica="El Jira se recorre con un <b>JQL</b> (su lenguaje de búsqueda): <code>project in (SOP, SEG) AND updated &gt;= \"aaaa-mm-dd hh:mm\" ORDER BY updated ASC</code>. Dos detalles reales: el JQL solo entiende <b>minutos</b>, y lee la fecha en la <b>zona del perfil</b> de la cuenta (aquí, Ciudad de México, UTC−6). Así que conviertes tu cursor (en UTC) a esa zona y lo cortas al minuto: lo que cayó en ese minuto vuelve a salir, y eso está bien porque procesar dos veces lo mismo no cambia nada (idempotencia). La ACL: quién ve el proyecto, donde «reportero» es el correo de quien abrió el ticket, y una segunda cláusula si el ticket tiene nivel de seguridad. Las políticas son más simples: el árbol de git trae el sha de cada archivo, que ya es su huella; comparas el árbol de hoy con el del cursor.",
    codigo=[py("pipeline/conectores/jira.py"), py("pipeline/conectores/politicas.py")],
    comandos=[
        cmd(P("p4 jql"), L("p4 jql"), "Con la hora en UTC sin convertir, Jira la lee como las 14:59 de Ciudad de México: seis horas después. No da error: da cero tickets."),
        cmd(P("p4 acl"), L("p4 acl"), "SOP-5 tiene nivel «Solo líderes»: ver el proyecto ya no alcanza."),
        cmd(f"{V} jira politicas", L("p4 verificar")),
    ],
    verifica="<code>verificar.py jira politicas</code> en verde.",
    ojo="La versión de un ticket es su <code>updated</code> tal cual viene (con su <code>-0600</code>); el «actualizado» del catálogo va en UTC con Z.",
    en_pagina={"conceptos": ["idempotencia"], "precalculos": []}))

G.append(dict(n=5, id="parsing", titulo="Del crudo al texto limpio", objetivo="HTML, PDF, ticket y Markdown a texto con estructura, sin boilerplate, con las tablas fila por fila y el escaneo detectado.",
    conceptos=["parsing", "boilerplate", "tabla-filas", "ocr"],
    explica="Un parser por tipo. <b>HTML</b> (con BeautifulSoup): fuera el menú, el pie y las macros; los títulos como <code>#</code> y <code>##</code>, cada ítem como <code>- </code> y cada fila de tabla con su encabezado. <b>PDF</b> (con pypdf): el texto de cada página, sin las líneas que se repiten en todas (el encabezado y el pie; los números se cambian por <code>#</code> para que «Página 1 de 2» y «Página 2 de 2» cuenten como la misma). Si casi no queda texto, no tiene capa de texto: <code>necesita_ocr</code>. <b>Ticket</b>: título, descripción sin la firma, resolución y los comentarios de personas sin el correo citado. <b>Markdown</b>: tal cual. <code>PARSER</code> es la versión de tu parser: si la subes, el almacén vuelve a parsear todo.",
    codigo=[py("pipeline/parsing.py")],
    comandos=[
        cmd(P("p5 html"), L("p5 html"), "Arriba, los primeros 420 caracteres del HTML que da la wiki; abajo, lo que deja tu parser."),
        cmd(P("p5 pdf"), L("p5 pdf"), "Arriba, lo que pypdf saca de la página 1, con el encabezado y el pie. Abajo, el texto de las dos páginas sin ellos, y el escaneo."),
        cmd(P("p5 ticket"), L("p5 ticket")),
        cmd(f"{V} parsing", L("p5 verificar")),
    ],
    verifica="<code>verificar.py parsing</code> en verde.",
    ojo="Los títulos de un PDF salen como líneas sueltas: pypdf no sabe qué es un título ni una tabla. En C11 un parser de layout recupera esa estructura.",
    en_pagina={"conceptos": ["parsing", "boilerplate", "tabla-filas", "ocr"], "precalculos": ["ocr"]}))

G.append(dict(n=6, id="almacen", titulo="El almacén por hash", objetivo="El texto guardado con el sha256 del crudo como nombre, comprobable, y el catálogo con la ACL y las lápidas.",
    conceptos=["hash-contenido", "fail-closed"],
    explica="El almacén tiene dos partes. <code>almacen/texto/&lt;sha256 del crudo&gt;.json</code> guarda el texto de un <b>contenido</b>: el nombre es su huella, así que el mismo contenido siempre cae en el mismo archivo. <code>tiene_texto(h)</code> responde «ya lo tengo» solo si el archivo existe, se parseó con el <code>PARSER</code> de hoy y su <code>sha256_texto</code> coincide con su texto: si alguien lo editó a mano, ya no sirve. <code>almacen/catalogo.json</code> guarda un registro por <b>documento</b>: su versión, su hash, su URL y su ACL. Un borrado no quita el registro: lo deja como <b>lápida</b> (tombstone), con su motivo y su fecha.",
    codigo=[py("pipeline/almacen.py")],
    comandos=[
        cmd(P("p6 hash"), L("p6 hash"), "El mismo contenido da el mismo hash, siempre: por eso el nombre del archivo basta para saber si ya lo parseaste."),
    ],
    verifica="El ejemplo de arriba: <code>tiene_texto</code> pasa de False a True y el mismo contenido da el mismo hash. Los checks <code>almacen</code> y <code>catalogo</code> se ponen en verde en el paso 7, con la primera corrida.",
    ojo="Hashea los bytes crudos, no el texto parseado: si hasheas el texto, tienes que parsear para saber si cambió, que es justo lo que querías evitar.",
    en_pagina={"conceptos": ["hash-contenido"], "precalculos": ["hash"]}))

G.append(dict(n=7, id="ingestar", titulo="La primera corrida (y la segunda)", objetivo="<code>procesar</code> e <code>incremental</code>: traer de las 4 fuentes, parsear solo el contenido nuevo, guardar el catálogo y los cursores.",
    conceptos=["cursor", "hash-contenido", "idempotencia"],
    explica="Por cada ref que te da un conector: si el catálogo ya tiene esa versión, ni lo traes (<b>sin_cambios</b>). Si no, lo traes (<b>descargados</b>), calculas el hash del crudo y, si el almacén ya tiene ese texto, no lo parseas (<b>saltados</b>); si no, lo parseas y lo guardas (<b>parseados</b>). Después lo registras con su versión, su hash y su ACL nuevos. La corrida incremental le pasa a cada conector su cursor (None la primera vez: todo) y guarda el cursor nuevo <b>solo si esa fuente terminó bien</b>. <code>main()</code> viene dado: corre las fuentes, atrapa <code>FuenteSinAcceso</code> por fuente, escribe la corrida en <code>almacen/corridas/</code> e imprime el resumen.",
    codigo=[py("pipeline/ingestar.py", "El archivo completo, con el barrido del paso 8.")],
    comandos=[
        cmd("python pipeline/ingestar.py", L("p7 primera"), "La primera vez, todo: 101 descargados y 101 parseados. La wiki tarda más por su límite de llamadas (y cuántos 429 recibe cambia un poco en cada corrida)."),
        cmd("python pipeline/ingestar.py", L("p7 segunda"), "Otra vez, enseguida: casi nada. Lo único que vuelve es lo que cae en el borde del cursor (la wiki con su ≥, el Jira con su minuto), y cuenta como sin_cambios."),
        cmd("ls almacen; ls almacen/texto | head -3\ncat almacen/texto/*.json | wc -c\ncat almacen/cursores.json", L("p7 almacen")),
        cmd(P("p7 registro"), L("p7 registro")),
        cmd(f"{V} almacen catalogo", L("p7 verificar")),
    ],
    verifica="<code>verificar.py almacen catalogo</code> en verde: 101 documentos vivos, cada uno con su texto íntegro y su ACL igual a la de la fuente.",
    ojo="Si guardas los cursores antes de procesar y la corrida se cae a la mitad, la siguiente empieza después de lo que nunca se guardó.",
    en_pagina={"conceptos": [], "precalculos": ["texto"]}))

G.append(dict(n=8, id="dia-2", titulo="Un día después: incremental, barrido y freno", objetivo="Que el día 2 entre solo lo que cambió, que el barrido encuentre lo que nadie avisó y que el freno no borre media fuente.",
    conceptos=["barrido", "fail-closed", "freno", "cursor"],
    explica="<code>mundo/avanzar.py</code> pasa un día: en la wiki se edita «Devoluciones», se republica sin cambios «Proveedores logísticos», se borra una macro, nace «Caso Envíos Express» dentro de «Litigios» y «Alta de vendedores» se restringe sin versión nueva; en el Drive, una versión nueva, una minuta a la papelera, un permiso quitado y un archivo que solo cambia de nombre; en el Jira, 3 tickets con comentarios, 2 nuevos y uno que pasa a «Solo líderes»; en las políticas, un cambio y un archivo nuevo. La corrida incremental trae casi todo, pero la wiki no avisa borrados ni cambios de permisos: eso lo encuentra el <b>barrido</b> (<code>--barrido</code>), que lista todo lo visible, deja lápidas de lo que ya no está, reprocesa lo de otra versión y vuelve a pedir las ACL. Y si quiere borrar más de <code>freno.max_borrado</code> de una fuente, no borra nada y lo anota.",
    codigo=[],
    comandos=[
        cmd("python mundo/avanzar.py", L("p8 avanzar")),
        cmd(f"{V} catalogo", L("p8 antes")),
        cmd("python pipeline/ingestar.py", L("p8 incremental"), "14 descargados y solo 11 parseados: el permiso de d01, el nombre de d08 y la republicación de 2005 traen los mismos bytes. La minuta de la papelera ya es lápida."),
        cmd(f"{V} catalogo", L("p8 sin barrido"), "La macro borrada sigue viva: la wiki no avisó."),
        cmd("python pipeline/ingestar.py --barrido", L("p8 barrido"), "Una lápida (la macro) y una ACL cambiada (la restricción nueva de «Alta de vendedores»), sin descargar nada."),
        cmd(P("p8 lapidas"), L("p8 lapidas")),
        cmd(f"{V} incremental barrido catalogo", L("p8 verificar")),
        cmd(V, L("final")),
    ],
    verifica="<code>verificar.py</code> completo en verde: 11 de 11.",
    ojo="El check <code>barrido</code> también prueba tu freno con un conector de mentiras que «ve» 3 de 10: con el freno roto, borraría 7.",
    en_pagina={"conceptos": ["barrido", "fail-closed", "freno"], "precalculos": ["cambios", "freno"]}))
e["guiado"] = G

# ---------------------------------------------------------------- solo
e["solo"] = {
    "reglas": [
        "Empieza con <code>python mundo/reiniciar.py</code>: deja el esqueleto, borra <code>almacen/</code> y vuelve al día 1.",
        "Sin GUION.md ni <code>mundo/referencia.py</code>: solo los contratos de arriba de cada archivo y estos objetivos.",
        "Claude corre <code>verificar.py</code> y te dice qué falla; no te da código.",
    ],
    "objetivos": [
        {"n": 1, "objetivo": "Las fuentes arriba y los cuatro tokens de config.yaml entran.", "check": "mundo"},
        {"n": 2, "objetivo": "<code>pedir()</code> devuelve JSON o bytes, None con 404, FuenteSinAcceso con 401 y sobrevive a los 429.", "check": "http", "pista": "¿Qué excepción lanza <code>urlopen</code> con un 429, y qué encabezado trae?"},
        {"n": 3, "objetivo": "La wiki: las 27 páginas, paginadas, con su ACL como intersección.", "check": "wiki", "pista": "¿De dónde sale la restricción de «Caso Transportes del Norte» si ella no tiene?"},
        {"n": 4, "objetivo": "El Drive: el feed de cambios con su token y la regla del link compartido.", "check": "drive"},
        {"n": 5, "objetivo": "El Jira: el JQL en la zona de la cuenta y al minuto, y el nivel de seguridad como segunda cláusula.", "check": "jira", "pista": "¿Qué hora es 14:59:40 UTC en Ciudad de México?"},
        {"n": 6, "objetivo": "Las políticas: nuevos, cambiados y borrados por el sha del árbol.", "check": "politicas"},
        {"n": 7, "objetivo": "El parsing: tablas fila por fila, sin menú ni pie, el escaneo detectado y el ticket sin firma ni citas.", "check": "parsing"},
        {"n": 8, "objetivo": "Cada documento vivo tiene su texto en <code>almacen/texto/&lt;hash&gt;.json</code>, íntegro.", "check": "almacen"},
        {"n": 9, "objetivo": "El catálogo coincide con las fuentes: los mismos documentos, las mismas versiones y las mismas ACL.", "check": "catalogo"},
        {"n": 10, "objetivo": "El día 2, la corrida incremental trae solo lo que cambió y no vuelve a parsear lo que tiene el mismo hash.", "check": "incremental", "pista": "Tres cambios del día 2 no cambian los bytes: ¿cuáles?"},
        {"n": 11, "objetivo": "El barrido deja lápidas de lo que ya no está y se frena si quiere borrar demasiado.", "check": "barrido"},
    ],
}

# ---------------------------------------------------------------- fallas
def falla(id_, titulo, tipo, historia, sintoma, hipotesis, confirma, arreglo, concepto, check):
    return dict(id=id_, titulo=titulo, tipo=tipo, historia=historia, sintoma=sintoma, hipotesis=hipotesis, confirma=confirma, arreglo=arreglo, concepto=concepto, check=check)


e["fallas"] = [
    falla("token-vencido", "La wiki dejó de cambiar", "infra",
          "Una agente actualizó ayer los tiempos de reembolso con débito y el asistente sigue diciendo los de antes. El job de ingestión «corrió» a su hora; nadie vio nada raro.",
          "<code>verificar.py</code> marca <code>mundo</code> (config.yaml no entra a la wiki) y <code>catalogo</code> (wiki:1004 con versión vieja). Las otras fuentes están al día.",
          ["Nadie corrió la ingestión.", "El conector de la wiki está fallando, pero la corrida no lo dice fuerte.", "El cursor de la wiki se adelantó y se saltó la edición."],
          cmd("python -c \"import json, glob; c = json.load(open(sorted(glob.glob('almacen/corridas/*.json'))[-1])); print(json.dumps(c['fuentes']['wiki'], ensure_ascii=False))\"", F("token corrida")),
          "TI rotó el token de la cuenta del conector. Pide el nuevo (<code>python mundo/fuentes.py token wiki</code> hace de administrador), ponlo en <code>fuentes.wiki.token</code> de config.yaml y corre <code>python pipeline/ingestar.py</code>. En C11 el token vive en un gestor de secretos y la alerta es de atraso por fuente: un conector sin acceso se ve igual que uno sin cambios.",
          "conector", "catalogo"),
    falla("sin-reintentos", "La ingestión truena con «HTTP Error 429»", "config",
          "La wiki bajó su límite de llamadas para todas las apps. El mismo día, alguien dejó los reintentos en 0 «para que la ingestión no se quede esperando».",
          "La corrida programada se cae con un traceback de <code>HTTPError: HTTP Error 429</code>; <code>verificar.py</code> marca <code>http</code> y <code>catalogo</code> (tres páginas con versión vieja).",
          ["La wiki está caída.", "Llamamos demasiado rápido y ya no reintentamos.", "Cambió el token."],
          cmd("python pipeline/ingestar.py 2>&1 | tail -4", F("reintentos job")),
          "<code>http.reintentos</code> vuelve a 5 y <code>python pipeline/ingestar.py</code>: con Retry-After la corrida tarda más, pero termina. El límite es de la fuente: se respeta, no se negocia quitando reintentos.",
          "rate-limit", "catalogo"),
    falla("restriccion-silenciosa", "Legal dice que ya nadie debería ver «Retención de datos»", "mundo",
          "Legal restringió la página «Retención de datos» a solo su autora mientras la reescriben. Pregunta por qué el asistente todavía la cita.",
          "<code>verificar.py catalogo</code>: wiki:3005 sigue viva en el catálogo y la fuente ya no la deja leer. La corrida incremental no vio nada.",
          ["La restricción todavía no se aplica en la wiki.", "La cuenta del conector perdió la página y nadie avisó.", "El catálogo tiene una copia vieja por un cursor atrasado."],
          cmd("python -c \"import sys; sys.path.insert(0, 'pipeline'); from conectores.http import pedir; print(pedir('wiki', '/paginas/3005'))\"", F("restriccion 404"), "None: un 404 para la cuenta del conector."),
          "<code>python pipeline/ingestar.py --barrido</code>: lista todo lo visible, ve que wiki:3005 ya no está y la deja como lápida. Regla del caso: lo que el conector ya no puede leer se borra del índice (fail-closed).",
          "fail-closed", "catalogo"),
    falla("link-como-dominio", "«Sueldos 2026» aparece para cualquiera", "config",
          "Producto pidió que los documentos «compartidos con link» aparezcan en el asistente, porque mucha gente comparte así. Alguien cambió una línea de config.yaml sin pasar por Seguridad.",
          "<code>verificar.py catalogo</code>: drive:d04 con una ACL distinta a la de la fuente, que ahora incluye <code>domain:marketplace.test</code>.",
          ["Alguien compartió los sueldos con todo el dominio en el Drive.", "Cambió la regla del link compartido en la configuración.", "El parser mezcló dos documentos."],
          cmd(f"{V} catalogo", F("link verificar")),
          "<code>drive.link_compartido</code> vuelve a <code>ignorar</code> y <code>python pipeline/ingestar.py --barrido</code>, que vuelve a pedir la ACL de lo que no cambió de versión. Link compartido = no compartido: es una decisión de producto y de Seguridad, no un switch de config.",
          "link-compartido", "catalogo"),
    falla("texto-alterado", "El asistente dice que la comisión de Electrónica es 6 %", "infra",
          "Alguien de datos vio «un error» en el texto guardado de las comisiones y lo corrigió directo en el almacén, para no esperar a la wiki.",
          "<code>verificar.py almacen</code>: el texto de wiki:2002 ya no coincide con su sha256_texto.",
          ["La wiki cambió la tabla.", "Alguien editó el almacén a mano.", "El parser cambió de versión."],
          cmd(f"{V} almacen", F("texto verificar")),
          "<code>python pipeline/ingestar.py --doc wiki:2002</code>: <code>tiene_texto()</code> ve que el archivo ya no es íntegro, vuelve a parsear y lo reemplaza con el texto de la fuente. La corrección, si es real, se hace en la fuente: el almacén es un derivado.",
          "hash-contenido", "almacen"),
    falla("unidad-perdida", "El barrido de la noche salió en rojo", "infra",
          "TI reorganizó la unidad compartida de operaciones y movió a sus miembros. El barrido de la noche terminó con código 1.",
          "<code>verificar.py</code> marca <code>catalogo</code> (11 documentos que la fuente ya no deja leer) y <code>barrido</code> (el último se frenó en drive).",
          ["Borraron media unidad compartida.", "La cuenta del conector perdió el acceso a la unidad.", "El feed de cambios se reinició."],
          cmd(f"{V} catalogo barrido", F("unidad verificar")),
          "No se arregla en el catálogo: se arregla el acceso. Pide a TI que regrese la cuenta (<code>python mundo/fuentes.py unidad on</code>) y vuelve a correr <code>python pipeline/ingestar.py --barrido</code>, que ya no se frena. Sin freno, el asistente habría perdido medio Drive por un permiso.",
          "freno", "barrido"),
]

# ---------------------------------------------------------------- listo, repaso, prompts
e["listo"] = [
    "Cada conector recorre su fuente completa, siguiendo su paginación, y respeta el límite de llamadas.",
    "Un 401 o 403 se anota como error de esa fuente, nunca como «sin cambios».",
    "Cada documento tiene su ACL como cláusulas, con la herencia de la wiki, el link compartido del Drive y el nivel de seguridad del Jira.",
    "El texto sale limpio y con estructura; el escaneo queda marcado para OCR.",
    "El texto se guarda por el hash del crudo y lo que no cambió de bytes no se vuelve a parsear.",
    "La corrida incremental trae solo lo nuevo, y el barrido encuentra lo que nadie avisó sin borrar media fuente por un permiso.",
]

e["repaso"] = {
    "memo": "<b>Cuatro fuentes, una forma; el hash decide qué se parsea; la ACL viaja con el documento.</b> Cada conector sabe listar, traer lo que cambió desde su cursor y leer los permisos de su fuente como cláusulas. El texto se guarda con el sha256 del crudo como nombre, así que lo que no cambió de bytes no se vuelve a procesar. Y los eventos dan la latencia, pero el barrido da la verdad: lo que ya no se puede leer se quita (con freno).",
    "trampa": "Un conector «vivo» que no trae nada. Con el token vencido, sin reintentos o sin acceso a una unidad, la ingestión puede seguir «corriendo» con el catálogo congelado, y el asistente contesta con seguridad lo de la semana pasada. Por eso los errores de acceso se lanzan, cada corrida deja sus cuentas por fuente y se alerta del atraso, no solo de la caída.",
    "entrevista": [
        {"q": "¿Cómo diseñas los conectores de un RAG con cuatro fuentes distintas?", "a": "Uno por fuente, con la misma forma: listar lo visible, traer los cambios desde un cursor, traer un documento y leer su ACL. Cada uno resuelve lo suyo (paginación, límite de llamadas, feed de cambios o polling por fecha, modelo de permisos) y el resto del pipeline no sabe de qué fuente viene el documento. Corren con una cuenta de servicio de solo lectura que Seguridad aprueba por fuente."},
        {"q": "¿Cómo evitas reprocesar todo cada noche?", "a": "Dos escalones. El cursor de cada fuente trae solo lo que cambió desde la última corrida (en C11, ≈ 1 % al día). Y el hash del contenido crudo decide si se parsea: un cambio de permisos, de nombre o una republicación idéntica bajan el archivo, pero no pasan por el parser ni por el OCR. El texto parseado se guarda por hash, así que re-chunkear después no vuelve a las APIs."},
        {"q": "¿Qué haces con las tablas y los PDFs escaneados?", "a": "Las tablas se escriben fila por fila con su encabezado («Categoría: Electrónica; Comisión: 8 %»), para que no se pierda qué valor va con qué fila. Un PDF sin capa de texto se detecta (casi no tiene texto extraíble), se marca y pasa por OCR una vez; nunca entra vacío. Y se mide con un slice del golden set de preguntas cuya respuesta es una celda o un escaneo."},
        {"q": "Alguien restringe una página y el asistente la sigue citando. ¿Qué falló?", "a": "Probablemente nada avisó: si la restringen a «solo yo», la cuenta del conector también la pierde y no recibe el evento. La regla es fail-closed: lo que el conector ya no puede leer se borra del índice, y un barrido periódico compara lo visible contra lo indexado. Con un freno: si una pasada quiere borrar más del 2 % de una fuente, se detiene y avisa, porque casi siempre es un permiso o una credencial."},
        {"q": "¿Por qué guardas la ACL como cláusulas y no como una lista de usuarios?", "a": "Porque los permisos se suman con AND: ver el espacio y estar en la restricción de la página y de cada ancestro. Una lista plana lo convertiría en OR. Y guardo principals (usuarios, grupos, dominio) sin expandir los grupos: cambiar a alguien de grupo no reescribe miles de documentos; los grupos de cada persona se resuelven en la consulta."},
    ],
}

e["prompts"] = {
    "claude_md": "kits/rag-ingesta/CLAUDE.md",
    "guiado": "content/estaciones/rag-ingesta/prompts/guiado.md",
    "solo": "content/estaciones/rag-ingesta/prompts/solo.md",
    "romper_ayuda": "content/estaciones/rag-ingesta/prompts/romper-ayuda.md",
    "romper_solo": "content/estaciones/rag-ingesta/prompts/romper-solo.md",
}

(APP / "content/estaciones/rag-ingesta.json").write_text(json.dumps(e, ensure_ascii=False, indent=2) + "\n")
print("ok", len(json.dumps(e, ensure_ascii=False)))
