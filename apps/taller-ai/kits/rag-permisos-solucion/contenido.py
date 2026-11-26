"""Arma content/estaciones/rag-permisos.json con las salidas reales de probar.sh y probar-fallas.sh.

    bash probar.sh /ruta/r3 && bash probar-fallas.sh /ruta/r3     # deja /ruta/r3.log y /ruta/r3-fallas.log
    python3 contenido.py /ruta/r3                                  # escribe el JSON con esas salidas

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
PROBARF = (SOL / "probar-fallas.sh").read_text()


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


def P(nombre: str, fuente: str = None) -> str:
    """El comando tal como lo corre probar.sh en la sección «nombre» (para no escribirlo dos veces)."""
    m = re.search(r'^paso "' + re.escape(nombre) + r'" (.*?)(?=^paso |^usa |^#|\Z)', fuente or PROBAR, re.S | re.M)
    if not m:
        sys.exit(f"no está el paso «{nombre}» en probar.sh")
    c = m.group(1).strip()
    if c.startswith("python -c \""):
        c = c.replace("\\\"", "\"")
    if c.startswith('sh -c "python -c \\"'):
        c = c[len('sh -c "'):-1].replace('\\"', '"')
    return c


def code(rel: str) -> str:
    return (SOL / rel).read_text().rstrip("\n")


def cmd(code_, salida, nota="", donde="mac"):
    return {"code": code_, "nota": nota, "donde": donde, "salida": salida}


def py(rel: str, nota: str = "") -> dict:
    return {"lang": "python", "path": rel, "code": code(rel), "nota": nota}


V = "python verificar.py"
CFG = "En <code>config.yaml</code>"

e = {
    "id": "permisos", "patron": "llm", "rama": "rag", "etapa": "datos", "num": 3,
    "titulo": "Permisos en cada chunk", "nav": "Permisos en cada chunk",
    "pregunta": "¿Cómo te aseguras de que el asistente nunca le dé a alguien un pedazo de un documento que esa persona no puede abrir, aunque cambie de equipo, aunque le quiten el permiso hace un minuto y aunque el índice se reconstruya?",
    "version": "2026-11-26",
}

e["mapa"] = {
    "resumen": "La estación 2 dejó cada documento partido en <b>chunks</b> (pedazos de ≈ 400 tokens), y cada chunk con la <b>ACL</b> de su documento: la lista de quién lo puede leer. Esta estación la hace valer. Primero, saber quién es quién: el <b>directorio</b> de la empresa dice en qué grupos está cada persona, y los grupos pueden estar dentro de otros grupos. Después, guardar la ACL <b>dentro de cada chunk del índice</b> tal como viene, con nombres de grupos y no con listas de personas, para que un cambio de equipo no obligue a reescribir millones de chunks. Al buscar, el <b>filtro de permisos va antes</b> de elegir los mejores chunks, y otra vez justo antes de armar el prompt. Una <b>prueba de permisos</b> pregunta como cada persona y compara con la verdad. Y como un permiso que se quita tiene que dejar de valer en minutos, no a la hora del siguiente reindexado, un <b>carril rápido</b> aplica cada cambio que avisan las fuentes, y el reindexado no lo puede deshacer.",
    "entra": [
        "lo que dejó la estación 2: <code>almacen/docs/&lt;doc&gt;.json</code>, los chunks de cada documento con su ACL en cláusulas y la hora en que la ingestión la leyó",
        "el directorio de la empresa (en C11, el proveedor de identidad): personas, grupos y qué grupo está dentro de cuál",
        "la cola de cambios de permisos que avisan las fuentes (el Drive, el Jira, la wiki y el directorio), uno por línea",
    ],
    "sale": [
        "<code>indice/indice.json</code>: cada chunk con su texto y su ACL, guardada como grupos; lo que llega sin ACL se queda fuera (fail-closed)",
        "<code>pipeline/buscar.py</code>: el top-k sale solo de lo que la persona puede ver, y un último filtro antes del prompt",
        "una prueba de permisos: cada persona del directorio contra la verdad, ni un chunk de más ni uno de menos",
        "el carril rápido: cada revocación aplicada en ≤ 5 min, sin volver a indexar, y una bitácora que el reindexado respeta",
    ],
    "escala": [
        {"que": "Documentos", "ref": "≈ 1.5 M, cada uno con su ACL", "taller": "105 documentos y 154 chunks, los que dejó la estación 2 el 21 de noviembre"},
        {"que": "Personas y grupos", "ref": "miles de personas en el proveedor de identidad, con grupos dentro de grupos", "taller": "14 personas (una externa y una recién contratada) y 13 grupos, hasta 3 niveles de anidamiento y un ciclo"},
        {"que": "Preguntas", "ref": "≈ 25k al día, cada una con el filtro de permisos", "taller": "las que haces con <code>pipeline/buscar.py --como &lt;correo&gt;</code>, y las 546 de la prueba de permisos"},
        {"que": "Revocaciones", "ref": "≤ 5 min para que una revocación se aplique", "taller": "5 revocaciones y un alta en la mañana del 21, la peor aplicada en 1 min"},
        {"que": "Dónde corre", "ref": "el filtro dentro del índice vectorial y un worker del carril rápido que lee la cola de eventos", "taller": "un JSON como índice y un reloj simulado que corre tu carril cada minuto de la mañana"},
    ],
}

e["precalculos"] = {
    "intro": "Antes de escribir código, las cuentas de servilleta de los permisos: cuánto pesa guardar la ACL como grupos o como personas, cuánto cuesta que alguien cambie de equipo, cuánto tiempo deja abierto un carril lento, cuántos resultados se pierden si filtras tarde y cuántas combinaciones tendría que probar una prueba de permisos. Cada cuenta va en las dos escalas: «En C11» (el caso real, con los supuestos dichos en voz alta) y «En el dojo» (medido en tu Mac con un comando).",
    "cuentas": [
        {"id": "grupos", "pregunta": "¿Guardo en cada chunk los grupos o la lista de personas?",
         "formula": "entradas guardadas = chunks × principals por ACL (en grupos) o chunks × personas que pueden ver (expandida)",
         "ref": {"cuenta": "7.5 M chunks × ≈ 3 principals (supuesto) contra × ≈ 400 personas (supuesto)", "valor": "22.5 M contra 3 mil millones de entradas"},
         "taller": {"cuenta": "medido en los 154 chunks con las 14 personas", "valor": "353 principals (2.3 por chunk) contra 952 entradas (6.2 por chunk)"},
         "decide": "Se guardan los grupos, tal como vienen en la ACL, y las personas se resuelven al preguntar. En el dojo la diferencia es de 3×; en una empresa con grupos de cientos de personas es de más de cien veces, y lo que más importa es la cuenta siguiente.",
         "conceptos": ["acl-en-chunk", "principal"],
         "comprueba": cmd(P("pc grupos"), L("pc grupos"))},
        {"id": "quitar", "pregunta": "¿Cuántos chunks hay que tocar si alguien sale de un grupo?",
         "formula": "en grupos: 0 chunks (cambia el directorio); expandida: todos los chunks cuya ACL nombra ese grupo",
         "ref": {"cuenta": "alguien sale de soporte, que aparece en el 10 % de 7.5 M chunks (supuesto)", "valor": "0 contra ≈ 750 mil chunks que reescribir"},
         "taller": {"cuenta": "Tomás sale de fraude a las 9:18", "valor": "0 contra 10 chunks"},
         "decide": "Con la ACL en grupos, un cambio de equipo es una línea en la copia del directorio y se aplica en segundos. Expandida, cada alta o baja reescribe miles de chunks en el índice: el carril rápido no alcanzaría.",
         "conceptos": ["grupo-anidado"],
         "comprueba": cmd(P("pc quitar"), L("pc quitar"))},
        {"id": "retraso", "pregunta": "¿Cada cuánto tiene que correr el carril rápido?",
         "formula": "peor caso = lo que tarda en llegar el aviso + el periodo del carril (+ lo que tarda en aplicarse) ≤ 5 min",
         "ref": {"cuenta": "≤ 5 min con ≈ 25k preguntas al día", "valor": "en 5 min caben ≈ 87 preguntas; con un carril de cada hora, ≈ 1,040"},
         "taller": {"cuenta": "aviso de 20 s + carril cada 60 s", "valor": "80 s en el peor caso (cada hora: 3,620 s, 12 veces el SLO)"},
         "decide": "El periodo del carril sale del SLO, no del costo: con avisos de 20 s, cualquier periodo de hasta 280 s cabe. Correrlo «cada hora, como el reindexado» deja una ventana de una hora en la que alguien que ya no debía sigue leyendo.",
         "conceptos": ["slo-revocacion", "carril-rapido"],
         "comprueba": cmd(P("pc retraso"), L("pc retraso"))},
        {"id": "postfiltro", "pregunta": "¿Cuántos resultados le quedan a alguien si filtras después del top-8?",
         "formula": "resultados ≈ k × fracción del corpus que la persona puede ver (si el permiso no tiene que ver con lo que pregunta)",
         "ref": {"cuenta": "alguien de un área chica que ve el 2 % del corpus, top-8", "valor": "0.16 en promedio: para asegurar 8 habría que pedir ≈ 400"},
         "taller": {"cuenta": "Ana ve el 57 %, Irene el 7 %, Diego el 1.9 %", "valor": "4.6, 0.6 y 0.2 resultados de 8"},
         "decide": "Filtrar después castiga más a quien ve menos, y no truena: el asistente contesta «no encontré información». Por eso el filtro va dentro de la búsqueda, antes de elegir el top-k.",
         "conceptos": ["pre-post-filtro", "top-k"],
         "comprueba": cmd(P("pc postfiltro"), L("pc postfiltro"))},
        {"id": "prueba", "pregunta": "¿Cuántas combinaciones tiene que probar una prueba de permisos?",
         "formula": "personas × ACL distintas (no personas × documentos: dos documentos con la misma ACL se prueban igual)",
         "ref": {"cuenta": "≈ 5,000 personas (supuesto) × 1.5 M documentos", "valor": "7.5 mil millones: no se prueban todas; se prueba una muestra con cuentas de prueba"},
         "taller": {"cuenta": "14 personas × 26 ACL distintas", "valor": "364 combinaciones: se prueban todas, en segundos"},
         "decide": "En el dojo la prueba es exhaustiva y la corre verificar.py. En C11 se agrupa por ACL distinta y se prueba con cuentas de prueba, una por grupo importante; la estación 12 la vuelve un monitoreo que corre solo.",
         "conceptos": ["prueba-permisos"],
         "comprueba": cmd(P("pc prueba"), L("pc prueba"))},
    ],
}

e["conceptos"] = [
    {"id": "principal", "termino": "Principal", "en": "principal", "def": "Cada «quién» que puede aparecer en una ACL: una persona (user:ana.ruiz@…), un grupo (group:soporte@…) o todo un dominio (domain:marketplace.test, cualquiera con correo de la empresa).",
     "analogia": "Como los nombres en la lista de una fiesta privada: puede decir «Ana Ruiz», «todo el equipo de soporte» o «cualquiera con gafete de la empresa».",
     "importa": "Para saber si alguien puede ver un chunk, juntas todos sus principals (su usuario, su dominio y todos sus grupos) y los comparas con los de la ACL.",
     "trampa": "Dar el domain: por el simple hecho de estar en el directorio: Luis es externo, su correo es de la paquetería aliada y no tiene el dominio de la empresa."},
    {"id": "directorio", "termino": "Directorio (proveedor de identidad)", "en": "identity provider, IdP", "def": "El sistema donde vive quién es quién en la empresa: cada persona, cada grupo y quién está en cuál. Las fuentes guardan sus permisos con esos mismos nombres de grupo.",
     "analogia": "Como el organigrama más la lista de credenciales de recursos humanos: si alguien cambia de área, se cambia ahí y en ningún otro lado.",
     "importa": "El índice guarda grupos; el directorio dice quién está detrás de cada grupo hoy. Tu pipeline trabaja con una copia (indice/directorio.json) que el carril rápido mantiene al día.",
     "trampa": "Preguntarle al directorio en cada pregunta: mete otro sistema en el camino de cada respuesta. Se guarda una copia y se mantiene al día con sus avisos."},
    {"id": "grupo-anidado", "termino": "Grupo anidado", "en": "nested group", "def": "Un grupo que es miembro de otro grupo: soporte-nivel1 está dentro de soporte, así que Ana, que está en soporte-nivel1, también es de soporte.",
     "analogia": "Como las muñecas rusas: abrir la grande no basta, hay que abrir todas las de adentro para ver quién está.",
     "importa": "Google Workspace y Microsoft Entra ID (en grupos de seguridad) dejan meter un grupo dentro de otro. La ACL dice group:soporte y casi nadie está ahí directo: sin recorrer los de adentro, el equipo pierde los manuales.",
     "trampa": "Cortar la búsqueda a un nivel «para que no se cuelgue»: así se pierden permisos legítimos. Lo que evita colgarse es llevar la cuenta de los grupos ya vistos."},
    {"id": "ciclo", "termino": "Ciclo de grupos", "en": "group membership cycle", "def": "Un grupo que, siguiendo los de adentro, termina dentro de sí mismo: el comité está dentro del boletín y el boletín dentro del comité.",
     "analogia": "Como dos espejos frente a frente: si sigues el reflejo, nunca acabas.",
     "importa": "Una búsqueda que sube por los grupos sin recordar dónde ya pasó da vueltas para siempre. Con un conjunto de «ya vistos», cada grupo se visita una vez y el ciclo no importa.",
     "trampa": "Creer que tu directorio no tiene ciclos. Basta con que dos personas agreguen un grupo dentro de otro sin saberlo."},
    {"id": "acl-clausulas", "termino": "ACL en cláusulas", "en": "ACL as AND of ORs", "def": "La forma en que la estación 1 dejó cada ACL: una lista de cláusulas. Hay que cumplir todas (AND), y para cumplir una basta uno de sus principals (OR).",
     "analogia": "Como la entrada a la sala de servidores: (gafete de empleado O de proveedor) Y (estar en la lista de TI). Una sola cosa no alcanza.",
     "importa": "Así se escribe sin perder nada «hay que poder ver el espacio Legal y además estar en litigios». Irene cumple las dos cláusulas del «Caso Transportes del Norte»; Paula, líder de soporte, solo la primera.",
     "trampa": "Aplanar las cláusulas en una sola lista: un permiso que era AND se vuelve OR, y cualquiera que cumpla una sola parte entra."},
    {"id": "fail-closed", "termino": "Fail-closed", "en": "fail-closed", "def": "Cuando falta un dato de permisos o viene roto, la respuesta es «no»: una ACL vacía, ausente o con una cláusula vacía no deja ver a nadie.",
     "analogia": "Como una puerta de seguridad que, si se va la luz, se queda cerrada en vez de abrirse.",
     "importa": "Un chunk que llega sin ACL no se sabe de quién es. Dejarlo fuera del índice lo saca del asistente un rato; meterlo «público» puede poner los sueldos al alcance de todos.",
     "trampa": "Tratar acl: [] como «sin restricciones», o tener un default de «público mientras llega su ACL»."},
    {"id": "acl-en-chunk", "termino": "ACL dentro de cada chunk", "en": "document-level security in the index", "def": "Cada chunk del índice lleva la ACL de su documento, con los principals tal cual (grupos, usuarios, dominio). Las personas se resuelven al momento de preguntar.",
     "analogia": "Como el sello «solo personal de soporte» en cada carpeta del archivo, en vez de una lista con 400 nombres que tendrías que reescribir en cada carpeta cada vez que alguien entra o sale del equipo.",
     "importa": "El buscador encuentra chunks, no documentos: el permiso tiene que viajar con cada chunk para poder filtrar dentro de la búsqueda. Y en grupos, porque un cambio de equipo no tiene que tocar el índice.",
     "trampa": "Guardar la ACL solo en el documento y revisarla «después»: el índice ya eligió los chunks sin saber de quién eran."},
    {"id": "top-k", "termino": "Top-k", "en": "top-k", "def": "Los k mejores resultados de una búsqueda. En C11, k = 8: los 8 chunks que llegan al prompt del LLM.",
     "analogia": "Como los 8 primeros resultados de un buscador: lo que no sale en esa lista, para ti no existe.",
     "importa": "El LLM solo puede contestar con lo que está en el top-k. Si el top-k sale vacío, el asistente dice «no encontré información» aunque la respuesta exista y la persona tenga permiso de leerla.",
     "trampa": "Elegir el top-k entre todo el índice y luego quitar lo que la persona no puede ver."},
    {"id": "pre-post-filtro", "termino": "Filtrar antes o después", "en": "pre-filtering vs post-filtering", "def": "Pre-filter: la búsqueda solo considera los chunks que la persona puede ver y de ahí elige el top-k. Post-filter: elige el top-k de todo y después tira lo ajeno.",
     "analogia": "Como buscar libros solo en los estantes a los que tienes acceso, contra elegir los 8 mejores de toda la biblioteca y que el bibliotecario te quite los prohibidos: te puedes quedar con las manos vacías.",
     "importa": "Con post-filter nadie recibe un chunk ajeno, así que parece seguro, pero quien ve poco recibe poco o nada. Ana pregunta por «cuenta de vendedor duplicada»: los 8 mejores son tickets de fraude y le llegan 0.",
     "trampa": "Confundir «no hay fuga» con «funciona». Y suponer que tu base vectorial filtra durante la búsqueda: pgvector, con índice aproximado, aplica el WHERE después de recorrerlo (estación 5)."},
    {"id": "defensa-profundidad", "termino": "El último filtro antes del prompt", "en": "defense in depth", "def": "Justo antes de armar el prompt, cada chunk se vuelve a revisar contra la ACL del índice con los principals de ese momento. Lo que no pasa no entra.",
     "analogia": "Como el guardia de la puerta del edificio y otro en la puerta de la sala: si al primero se le pasó alguien, el segundo lo detiene.",
     "importa": "Entre la búsqueda y el prompt hay código (un reranker, un caché, un cambio de mañana) que puede colar un chunk. Y la ACL que manda es la del índice, no la que dice el resultado: un resultado se puede armar con cualquier ACL.",
     "trampa": "Confiar en el campo acl que trae el resultado. El check prompt le da a contexto() «Sueldos 2026» con una ACL falsa de todo el dominio."},
    {"id": "prueba-permisos", "termino": "Prueba de permisos", "en": "permission probe", "def": "Preguntar como cada persona y comparar lo que recibe con la verdad: ni un chunk que no puede ver (fuga), ni uno menos de los que sí (acceso).",
     "analogia": "Como el cliente misterioso de una tienda: alguien que entra como cualquier cliente para comprobar que lo atienden como dice la regla.",
     "importa": "Es lo que dice «permisos al 100 %» en el gate de C11 (estación 9). La fuga es el error grave; el acceso de menos es el que nadie reporta, porque el asistente solo parece no saber.",
     "trampa": "Probar solo con tu propia cuenta, que ve casi todo. Las fallas aparecen en quien ve poco: el externo, el recién contratado, el área chica."},
    {"id": "slo-revocacion", "termino": "Revocación y su SLO", "en": "revocation SLO", "def": "Revocar es quitarle un permiso a alguien. El SLO (el objetivo de servicio que el equipo se compromete a cumplir) de C11 es que una revocación se aplique en ≤ 5 min.",
     "analogia": "Como desactivar la tarjeta de acceso de alguien que se va de la empresa: si tarda una hora en dejar de abrir la puerta, durante una hora sigue entrando.",
     "importa": "Mientras la revocación no se aplica, la persona sigue recibiendo esos chunks. Lo que se mide es la exposición: cuánto tiempo pudo ver lo que ya no debía.",
     "trampa": "Medir solo que «al final quedó bien». A las 10:30 todo puede estar correcto y aun así alguien estuvo 52 minutos leyendo las tarifas negociadas."},
    {"id": "carril-rapido", "termino": "Carril rápido", "en": "fast lane / permission sync", "def": "Un camino aparte del reindexado: cada fuente avisa sus cambios de permisos con un webhook (un mensaje que manda sola a una URL tuya), el aviso cae en una cola y un worker lo aplica sin reindexar.",
     "analogia": "Como la caja rápida del súper: el reindexado es la fila normal con el carrito lleno; un cambio de permiso no puede esperar detrás.",
     "importa": "Un cambio de ACL reescribe solo la ACL de los chunks de ese documento (en el dojo, 5 chunks); un cambio de grupo, solo la copia del directorio. Por eso cabe en segundos.",
     "trampa": "Hacerlo correr «cada hora, como el reindexado»: entonces ya no es un carril rápido."},
    {"id": "cursor", "termino": "Cursor e idempotencia", "en": "cursor, idempotency", "def": "El cursor anota hasta qué evento de la cola llegaste; idempotente quiere decir que aplicar lo mismo dos veces deja todo igual que aplicarlo una.",
     "analogia": "Como el separador de un libro: sabes dónde te quedaste. Y si por error relees una página, la historia no cambia.",
     "importa": "Si el carril truena a la mitad, la siguiente pasada vuelve a empezar después del cursor y repite algunos eventos: como aplicar dos veces da lo mismo, no pasa nada. Por eso el cursor se mueve al final.",
     "trampa": "Mover el cursor antes de aplicar: si truena en medio, esos eventos se pierden. Y creer que todo aviso llega: los webhooks de Jira y Confluence son de entrega «best effort»."},
    {"id": "gana-la-nueva", "termino": "Gana la ACL más nueva", "en": "last write wins (by source time)", "def": "Cada ACL lleva la hora en que la fuente la cambió. El reindexado, que trae la ACL que leyó la ingestión a las 9:05, no puede pisar la del carril rápido de las 9:07.",
     "analogia": "Como dos cartas del mismo banco con tu saldo: vale la de fecha más reciente, no la que abriste al último.",
     "importa": "El reindexado de las 10:00 reconstruye el índice desde los chunks, que todavía traen la ACL vieja. Sin la bitácora del carril (acl_vigente.json), deshace en un segundo las revocaciones de la mañana.",
     "trampa": "Ordenar por «lo último que escribí» en vez de por la hora del cambio en la fuente. Y borrar la bitácora del carril creyendo que es un log."},
]

e["mundo"] = {
    "resumen": "El kit trae la mañana del 21 de noviembre en el marketplace ficticio del caso. Está lo que dejó la estación 2: <b>154 chunks de 105 documentos</b> (la wiki, el Drive, el Jira y las políticas), cada uno con su ACL. Está el <b>directorio de la empresa</b>, con 14 personas y 13 grupos, unos dentro de otros. Y está una <b>cola de seis cambios de permisos</b> que avisan las fuentes entre las 9:07 y las 9:52. Tú escribes los permisos: quién es quién, la ACL en cláusulas, el índice con la ACL en cada chunk, la búsqueda que filtra antes del top-k y otra vez antes del prompt, y el carril rápido. Después el mundo pasa la mañana minuto a minuto con tu código y mide cuánto tiempo pudo ver cada persona lo que ya no debía. Sin Docker, sin GPU y sin internet después del <code>pip install</code>.",
    "trae": [
        {"que": "mundo/entrada/docs/", "detalle": "La salida de la estación 2, como salió de correr su kit con su solución: un archivo por documento con sus chunks y su ACL, más <code>acl_leida</code>, la hora en que la ingestión de la estación 1 leyó esa ACL (9:05 del 21)."},
        {"que": "El directorio", "detalle": "14 personas: cinco agentes de soporte (uno es Luis, externo, de la paquetería aliada), una líder de soporte, tres de operaciones, una de finanzas, uno de fraude, una de recursos humanos, una de legal y Diego, recién contratado, sin equipo todavía. 13 grupos con hasta 3 niveles de anidamiento y un ciclo (el comité dentro del boletín y el boletín dentro del comité)."},
        {"que": "La mañana del 21", "detalle": "<code>mundo/avanzar.py</code> pasa de las 9:00 a las 10:30: seis avisos de permisos (cuatro revocaciones de documentos o de grupos, una baja de un externo y un alta), tu carril rápido cada minuto y el reindexado de las 10:00. Después de cada corrida le pregunta a tu <code>buscar.py</code> qué ve cada persona y mide la exposición."},
        {"que": "Un buscador de juguete", "detalle": "<code>pipeline/_comun.py</code> trae <code>puntaje()</code>: cuántas palabras de la pregunta aparecen en el chunk. No es el buscador de C11 (ese es BM25 y vectores, estación 5): está para que el filtro de permisos tenga algo que filtrar."},
        {"que": "verificar.py y romper.py", "detalle": "Los 9 checks de la estación (de <code>mundo</code> a <code>revocacion</code>) y las 6 fallas: filtro después del top-k, ACL vieja tras una revocación, grupo anidado sin resolver, chunk sin ACL que se vuelve público, la bitácora del carril borrada y la suscripción del directorio vencida."},
    ],
    "tu_pipeline": [
        {"archivo": "pipeline/directorio.py", "hace": "Paso 1: los principals de una persona, con sus grupos anidados y sin colgarse en un ciclo."},
        {"archivo": "pipeline/permisos.py", "hace": "Paso 2: la ACL en cláusulas contra los principals, fail-closed."},
        {"archivo": "pipeline/indexar.py", "hace": "Paso 3 (y 8): el índice con la ACL de cada chunk en grupos, sin lo que llega sin ACL, y respetando lo del carril rápido."},
        {"archivo": "pipeline/buscar.py", "hace": "Pasos 4 y 5: lo que ve cada persona, el top-k filtrado antes y el último filtro antes del prompt."},
        {"archivo": "pipeline/revocar.py", "hace": "Paso 7: el carril rápido: la cola, el cursor, la ACL nueva en los chunks de un documento, el cambio de grupo en la copia del directorio y su bitácora."},
        {"archivo": "config.yaml", "hace": "La profundidad de los grupos, qué hacer sin ACL, el top-k y el filtro, y cada cuánto corre el carril."},
    ],
    "requisitos": [
        "Python 3.10 o más nuevo (se probó con 3.14.3) y ≈ 15 MB para el entorno virtual",
        "Internet solo para el <code>pip install</code> (pyyaml 6.0.3)",
        "Las estaciones 1 y 2 ayudan, pero no hacen falta: el kit trae su salida",
    ],
    "sustituciones": [
        {"nube": "El proveedor de identidad de la empresa", "local": "<code>almacen/directorio.json</code> y tu copia en <code>indice/</code>", "diferencia": "La misma idea: personas, grupos y grupos dentro de grupos. En C11 son miles de personas y la copia se mantiene con los avisos del proveedor; aquí son 14 y los avisos vienen en la cola."},
        {"nube": "Webhooks de las fuentes hacia una cola", "local": "<code>almacen/eventos.jsonl</code>, que escribe el mundo", "diferencia": "En C11 cada fuente manda sus avisos a una URL del equipo y caen en una cola de mensajes; aquí el mundo los escribe con la hora en que «llegaron» (20 s después del cambio)."},
        {"nube": "Un worker que corre solo", "local": "<code>python pipeline/revocar.py</code>, que el mundo corre cada minuto simulado", "diferencia": "La hora del mundo es simulada (<code>almacen/mundo.json</code>): una mañana entera pasa en unos segundos, y siempre igual."},
        {"nube": "El filtro dentro del índice vectorial", "local": "Un JSON y un filtro en Python", "diferencia": "En la estación 5 el índice es de verdad (BM25 y vectores) y el filtro de permisos va dentro de la búsqueda, con la misma ACL en cada chunk."},
    ],
    "arranque": "unzip rag-permisos.zip && cd rag-permisos\npython3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt\npython mundo/crear.py",
    "python": "python",
}

G = []
G.append(dict(n=0, id="mundo", titulo="Levantar el mundo", objetivo="El almacén de la mañana del 21 en <code>almacen/</code>: los chunks de la estación 2, el directorio y la cola vacía.",
    conceptos=["directorio"],
    explica="Solo hace falta pyyaml. <code>mundo/crear.py</code> copia de <code>mundo/entrada/</code> a <code>almacen/</code> los chunks que dejó la estación 2, el directorio de la empresa y una cola de eventos vacía, y pone el reloj del mundo a las 9:00 de Ciudad de México. Tu pipeline lee <code>almacen/</code> y escribe en <code>indice/</code>.",
    codigo=[],
    comandos=[
        cmd("python3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt", L("p0 venv"), "Desde aquí, cada terminal nueva necesita <code>source .venv/bin/activate</code>."),
        cmd("python mundo/crear.py", L("p0 crear")),
        cmd(f"{V} mundo", L("p0 verificar")),
        cmd(f"{V} principals", L("p0 esqueleto"), "Es lo esperado: <code>pipeline/</code> todavía es el esqueleto. Cada check se pone en verde en su paso."),
    ],
    verifica="<code>verificar.py mundo</code> en verde.",
    ojo="La hora del mundo no es la de tu Mac: vive en <code>almacen/mundo.json</code> y la lees con <code>ahora()</code> de <code>_comun.py</code>. Así la mañana del paso 8 pasa en segundos y sale igual cada vez."))
G.append(dict(n=1, id="principals", titulo="Quién es quién", objetivo="<code>principals()</code>: el usuario, el dominio y todos los grupos de una persona, también los de adentro, sin colgarse en un ciclo.",
    conceptos=["principal", "directorio", "grupo-anidado", "ciclo"],
    explica="Una ACL no dice «Ana»: dice <code>group:soporte</code>. Para saber si Ana entra, juntas sus <b>principals</b>: <code>user:ana.ruiz@…</code>, <code>domain:</code> y lo que va después de la @ de su correo, y cada grupo al que pertenece. El directorio da los grupos al revés de como los necesitas (cada grupo con sus miembros), así que primero armas «miembro → grupos que lo tienen». Después subes por niveles: los grupos de Ana; los grupos que contienen a esos grupos; y así. Ana está en soporte-nivel1, y soporte-nivel1 está dentro de soporte. Un conjunto de «ya vistos» hace que el ciclo comité ⇄ boletín no te cuelgue. <code>profundidad</code> es un tope de seguridad, no la forma de evitar ciclos.",
    codigo=[py("pipeline/directorio.py", "<code>copia()</code> y <code>guardar_copia()</code> vienen dadas: leen y escriben tu copia del directorio en <code>indice/</code>.")],
    comandos=[
        cmd(P("p1 principals"), L("p1 principals"), "Con profundidad 1, Ana no es «soporte». Paula, líder, termina también en el comité y el boletín por el ciclo. Luis es externo: su dominio es el de la paquetería."),
        cmd(f"{V} principals", L("p1 verificar")),
    ],
    verifica="<code>verificar.py principals</code> en verde: las 14 personas con sus principals exactos, la profundidad 1 da solo los grupos directos y alguien que no está en el directorio no tiene ninguno.",
    ojo="El <code>domain:</code> sale del correo de la persona, no del directorio: estar en el directorio de la empresa no te hace de la empresa. Luis entra a soporte por su grupo, pero no ve lo compartido con todo marketplace.test."))
G.append(dict(n=2, id="permisos", titulo="¿Puede verlo?", objetivo="<code>puede_ver()</code>: la ACL en cláusulas contra los principals, con «no» como respuesta cuando la ACL falta o viene rota.",
    conceptos=["acl-clausulas", "fail-closed"],
    explica="La estación 1 dejó cada ACL como <b>cláusulas</b>: hay que cumplir todas, y en cada una basta un principal. En Python cabe en una línea: <code>all(any(p in principals for p in c) for c in acl)</code>. Pero antes, <code>acl_valida()</code>: una lista con al menos una cláusula, cada cláusula con al menos un principal y cada principal con su prefijo. Ojo con <code>all()</code> sobre una lista vacía: da <code>True</code>. Sin esa revisión, una ACL vacía dejaría ver a todos. Eso es <b>fail-closed</b>: si falta el dato, la respuesta es no.",
    codigo=[py("pipeline/permisos.py")],
    comandos=[
        cmd(P("p2 casos"), L("p2 casos"), "Paula cumple la primera cláusula (es líder de soporte) pero no está en litigios."),
        cmd(f"{V} permisos", L("p2 verificar")),
    ],
    verifica="<code>verificar.py permisos</code> en verde: los 10 casos, del OR dentro de una cláusula a la ACL vacía, rota o ausente.",
    ojo="<code>all([])</code> es <code>True</code> en Python (y en casi cualquier lenguaje): sin <code>acl_valida()</code>, <code>[]</code> sería «todos»."))
G.append(dict(n=3, id="indice", titulo="La ACL dentro de cada chunk", objetivo="<code>indexar.py</code>: cada chunk en el índice con su texto y la ACL de su documento, tal cual, en grupos; lo que llega sin ACL válida se queda fuera.",
    conceptos=["acl-en-chunk"],
    explica="El buscador encuentra chunks, así que cada chunk del índice lleva su ACL: el permiso viaja con el pedazo. Se guarda <b>tal cual</b>, con los grupos, sin expandirla a personas: quién está detrás de cada grupo se resuelve al preguntar, con el directorio de ese momento. Un documento con una ACL que no pasa <code>acl_valida()</code> no entra (fail-closed) y queda en <code>sin_acl</code>. <code>indexar.py</code> también refresca tu copia del directorio y anota por documento de dónde salió su ACL y desde cuándo vale (<code>acl_desde</code>). La parte que respeta lo del carril rápido (<code>acl_vigente.json</code>) es del paso 8: por ahora ese archivo no existe.",
    codigo=[py("pipeline/indexar.py", "<code>main()</code> viene dada. En este paso, <code>construir()</code> sin las dos líneas de <code>vigente</code>; las agregas en el paso 8.")],
    comandos=[
        cmd("python pipeline/indexar.py", L("p3 indexar")),
        cmd(P("p3 un chunk"), L("p3 un chunk"), "«Clientes VIP y compensaciones»: dos cláusulas, y la segunda pide ser líder de soporte."),
        cmd(f"{V} indice", L("p3 verificar")),
    ],
    verifica="<code>verificar.py indice</code> en verde: los 154 chunks, cada uno con la ACL exacta de su documento, y ninguno sin ACL.",
    ojo="La cuenta del check: 19 principals distintos en todo el índice, contra 952 entradas si guardaras una por persona y chunk. Con miles de personas, la diferencia es de cientos de veces.",
    en_pagina={"precalculos": ["grupos", "quitar"]}))
G.append(dict(n=4, id="filtro", titulo="Filtrar antes del top-k", objetivo="<code>buscar()</code>: el top-8 sale solo de los chunks que la persona puede ver. Y la versión que filtra después, para comparar.",
    conceptos=["top-k", "pre-post-filtro"],
    explica="<code>visibles()</code> es el filtro: los chunks cuya ACL pasa con los principals de la persona. <code>buscar()</code> calcula el <code>puntaje()</code> (el buscador de juguete de <code>_comun.py</code>) y se queda con los <b>k mejores</b>. El orden de esas dos cosas es la decisión de la estación. <b>Antes</b> (pre-filter): el top-8 se elige entre lo que la persona puede ver. <b>Después</b> (post-filter): se elige el top-8 de todo y se tira lo ajeno. Las dos versiones van en el código, elegidas por <code>busqueda.filtro</code>, para que veas la diferencia con tus ojos.",
    codigo=[py("pipeline/buscar.py", "En este paso, <code>mis_principals()</code>, <code>visibles()</code> y <code>buscar()</code>. <code>contexto()</code> es del paso 5; <code>indice()</code> y <code>main()</code> vienen dadas.")],
    comandos=[
        cmd('python pipeline/buscar.py --como ana.ruiz@marketplace.test "Cuenta de vendedor duplicada"', L("p4 antes")),
        cmd(f"# {CFG.replace('<code>', '').replace('</code>', '')}: busqueda.filtro: despues\npython pipeline/buscar.py --como ana.ruiz@marketplace.test \"Cuenta de vendedor duplicada\"\n# y regrésalo a antes", L("p4 despues"),
            "Los 8 mejores de todo el índice son los 10 tickets de fraude, y Ana no es de fraude: le llegan 0. Nadie recibió nada ajeno, y aun así el asistente no sirve."),
        cmd(f"{V} filtro", L("p4 verificar")),
    ],
    verifica="<code>verificar.py filtro</code> en verde: 14 personas × 12 preguntas, cada una recibe sus mejores chunks entre los que puede ver.",
    ojo="Que el filtro vaya antes no significa revisar los 7.5 M de chunks de C11 en Python: el índice de verdad filtra mientras busca. Aquí son 154 y se puede recorrerlos.",
    en_pagina={"precalculos": ["postfiltro"]}))
G.append(dict(n=5, id="prompt", titulo="El último filtro antes del prompt", objetivo="<code>contexto()</code>: cada resultado se vuelve a revisar contra la ACL del índice justo antes de entrar al prompt.",
    conceptos=["defensa-profundidad"],
    explica="Entre la búsqueda y el prompt van a pasar cosas: en la estación 6 un reranker reordena, y tal vez un día un caché de respuestas. Cualquiera puede colar un chunk. <code>contexto()</code> es el último guardia: por cada resultado, busca <b>su chunk en el índice</b> (no confía en el <code>acl</code> que trae el resultado), recalcula los principals de la persona en ese momento y solo deja pasar lo que puede ver. Arma el texto del prompt con un bloque por fuente, «[1] chunk_id» y su texto: esos números son los que el LLM va a citar en la estación 8.",
    codigo=[],
    comandos=[
        cmd(P("p5 contexto"), L("p5 contexto"), "Un resultado falso de «Sueldos 2026» que dice ser de todo el dominio: el índice dice que es solo de Lucía, y no pasa."),
        cmd(f"{V} prompt", L("p5 verificar")),
    ],
    verifica="<code>verificar.py prompt</code> en verde: lo ajeno y lo que no está en el índice se quedan en <code>descartados</code>, y el texto lleva cada fuente numerada.",
    ojo="Los principals se calculan otra vez aquí, no se reusan los de la búsqueda: si alguien perdió un grupo hace un segundo, ya cuenta."))
G.append(dict(n=6, id="prueba", titulo="La prueba de permisos", objetivo="Comprobar, como cada persona del directorio, que nadie recibe un chunk ajeno y que nadie se queda sin lo que sí puede ver.",
    conceptos=["prueba-permisos"],
    explica="Hasta aquí cada pieza pasó su check. La <b>prueba de permisos</b> las prueba juntas, como una persona de verdad: por cada una de las 14 personas, lo que <code>visibles()</code> le deja ver contra la verdad del mundo. Y por cada pregunta (una por cada ACL distinta del índice, más las 12 del filtro), lo que llega a <code>contexto()</code>. Son dos checks: <code>fuga</code> (nada de más) y <code>acceso</code> (nada de menos). Pruébalo tú: la misma pregunta como Diego y como Lucía.",
    codigo=[],
    comandos=[
        cmd('python pipeline/buscar.py --como diego.luna@marketplace.test "¿Cuánto gana un líder de soporte?"', L("p6 diego"), "Diego, recién contratado, solo ve lo que es de todo el dominio: 3 chunks."),
        cmd('python pipeline/buscar.py --como lucia.mora@marketplace.test "¿Cuánto gana un líder de soporte?"', L("p6 lucia"), "Lucía, de recursos humanos, es la única que ve «Sueldos 2026»."),
        cmd(f"{V} fuga acceso", L("p6 verificar")),
    ],
    verifica="<code>verificar.py fuga acceso</code> en verde: 532 búsquedas sin un chunk ajeno y cada persona con justo lo que le toca.",
    ojo="La prueba vale lo que valen sus personas: si todas vieran casi todo, nunca encontraría nada. Por eso el directorio trae a un externo, a un recién contratado y áreas chicas.",
    en_pagina={"precalculos": ["prueba"]}))
G.append(dict(n=7, id="carril", titulo="El carril rápido", objetivo="<code>revocar.py</code>: aplica los cambios de permisos de la cola en el índice y en la copia del directorio, sin reindexar, con su cursor y su bitácora. Y la mañana del 21.",
    conceptos=["slo-revocacion", "carril-rapido", "cursor"],
    explica="Las fuentes avisan cada cambio de permisos con un <b>webhook</b>, y el aviso cae en la cola, <code>almacen/eventos.jsonl</code>. Hay dos tipos. Un evento <code>acl</code> trae la ACL nueva completa de un documento: la escribes en cada uno de sus chunks del índice (sin tocar el texto: no se vuelve a indexar nada) y la anotas en <code>acl_vigente.json</code> con la hora del cambio. Un evento <code>membresia</code> mete o saca a alguien de un grupo: cambias la copia del directorio y ningún chunk. El <b>cursor</b> dice hasta qué evento llegaste, y se mueve al final, cuando todo quedó escrito. Cada evento aplicado deja una línea en <code>revocaciones.jsonl</code>. Después, <code>mundo/avanzar.py</code> pasa la mañana: corre tu carril cada minuto y mide la exposición de cada revocación.",
    codigo=[py("pipeline/revocar.py")],
    comandos=[
        cmd("python pipeline/revocar.py", L("p7 nada"), "Con la cola vacía, nada que hacer."),
        cmd("python mundo/avanzar.py", L("p7 manana"), "La mañana entera con tu código. «Exposición» es cuánto tiempo pudo ver alguien lo que ya no debía: de que cambió en la fuente a que tu carril lo aplicó."),
        cmd("cat indice/revocaciones.jsonl", L("p7 bitacora"), "La ACL de las tarifas tocó 5 chunks; los cambios de grupo, ninguno."),
        cmd('python pipeline/buscar.py --como hugo.salas@marketplace.test "Tarifas de envío por estado"', L("p7 hugo"), "A Hugo ya no le sale la tabla de tarifas (drive:d21): desde las 9:08 es solo de líderes."),
        cmd(f"{V} revocacion", L("p7 verificar")),
    ],
    verifica="<code>verificar.py revocacion</code> en verde: las 5 revocaciones aplicadas en ≤ 5 min, el alta aplicada y cada evento anotado con los chunks que tocó.",
    ojo="Si un evento <code>acl</code> llega más viejo que la ACL que ya tiene el índice, no la toques: las colas pueden entregar fuera de orden, y gana la hora del cambio en la fuente.",
    en_pagina={"precalculos": ["retraso"]}))
G.append(dict(n=8, id="reindexado", titulo="Lo que el reindexado no puede deshacer", objetivo="El reindexado de cada hora respeta lo del carril rápido; y si el índice se reconstruye desde cero, el carril vuelve a aplicar la cola.",
    conceptos=["gana-la-nueva"],
    explica="A las 10:00 corrió el reindexado, desde <code>almacen/docs/</code>, que todavía trae las ACL que la ingestión leyó a las 9:05. Si <code>indexar.py</code> solo copiara esas ACL, deshacería las revocaciones de la mañana. Por eso <code>construir()</code> lee <code>acl_vigente.json</code>: si la ACL del carril es más nueva que la <code>acl_leida</code> del documento, gana la del carril (son las dos líneas de <code>vigente</code> del paso 3). En la salida del paso 7 ya se vio: «ninguna revocación volvió». Ahora mira qué pasa si alguien reconstruye con <code>--desde-cero</code>, que borra también la bitácora y el cursor.",
    codigo=[],
    comandos=[
        cmd(P("p8 vigente"), L("p8 vigente"), "Lo que el carril aplicó, con la hora del cambio en la fuente."),
        cmd("python pipeline/indexar.py --desde-cero", L("p8 desde cero")),
        cmd(f"{V} fuga", L("p8 fuga"), "Sin la bitácora, el índice volvió a las ACL de las 9:05: Ana ve otra vez el ticket SOP-14."),
        cmd("python pipeline/revocar.py", L("p8 carril"), "Sin cursor, el carril empieza desde el primer evento de la cola y vuelve a aplicar todo. Aplicar dos veces da lo mismo."),
        cmd(V, L("p8 verificar")),
    ],
    verifica="<code>verificar.py</code> completo en verde, con <code>revocacion</code>: el reindexado de las 10:00 no deshizo ninguna revocación.",
    ojo="La cola guarda los eventos (una cola de verdad se configura para guardarlos días), y eso es lo que permite reconstruir desde cero. Si la cola los hubiera borrado, después de un <code>--desde-cero</code> haría falta leer otra vez los permisos de cada documento en su fuente."))
EN_PAGINA = {1: (["principal", "directorio", "grupo-anidado", "ciclo"], []), 2: (["acl-clausulas", "fail-closed"], []), 3: (["acl-en-chunk"], ["grupos", "quitar"]),
             4: (["top-k", "pre-post-filtro"], ["postfiltro"]), 5: (["defensa-profundidad"], []), 6: (["prueba-permisos"], ["prueba"]),
             7: (["slo-revocacion", "carril-rapido", "cursor"], ["retraso"]), 8: (["gana-la-nueva"], [])}
for g in G:
    g.pop("en_pagina", None)
    if g["n"] in EN_PAGINA:
        g["en_pagina"] = {"conceptos": EN_PAGINA[g["n"]][0], "precalculos": EN_PAGINA[g["n"]][1]}
e["guiado"] = G

e["solo"] = {
    "reglas": [
        "Empieza con <code>python mundo/reiniciar.py</code>: deja el esqueleto, borra <code>indice/</code> y vuelve a las 9:00.",
        "Sin GUION.md ni <code>mundo/referencia.py</code>: solo los contratos de arriba de cada archivo y estos objetivos.",
        "Claude corre <code>verificar.py</code> y te dice qué falla; no te da código.",
    ],
    "objetivos": [
        {"n": 1, "objetivo": "El almacén de la mañana del 21 en su lugar.", "check": "mundo"},
        {"n": 2, "objetivo": "Los principals de cada persona: usuario, dominio de su correo y todos sus grupos, también los de adentro, sin colgarse en un ciclo.", "check": "principals", "pista": "¿Qué guardas para no volver a visitar un grupo?"},
        {"n": 3, "objetivo": "La ACL en cláusulas: AND entre cláusulas, OR dentro de cada una, y una ACL vacía o rota no deja ver a nadie.", "check": "permisos", "pista": "¿Qué da all() sobre una lista vacía?"},
        {"n": 4, "objetivo": "Cada chunk en el índice con la ACL exacta de su documento, en grupos; sin ACL válida, fuera.", "check": "indice"},
        {"n": 5, "objetivo": "El top-k sale solo de lo que la persona puede ver.", "check": "filtro"},
        {"n": 6, "objetivo": "El último filtro antes del prompt revisa contra la ACL del índice, no contra la del resultado.", "check": "prompt"},
        {"n": 7, "objetivo": "Nadie recibe un chunk ajeno, ni en la búsqueda ni en el prompt.", "check": "fuga"},
        {"n": 8, "objetivo": "Cada persona ve todo lo que le toca.", "check": "acceso"},
        {"n": 9, "objetivo": "En la mañana del 21, cada revocación se aplica en ≤ 5 min y el reindexado de las 10:00 no la deshace.", "check": "revocacion", "pista": "A las 10:00, ¿de dónde saca la ACL el reindexado?"},
    ],
}


def falla(id_, titulo, tipo, historia, sintoma, hipotesis, confirma, arreglo, concepto, check):
    return dict(id=id_, titulo=titulo, tipo=tipo, historia=historia, sintoma=sintoma, hipotesis=hipotesis, confirma=confirma, arreglo=arreglo, concepto=concepto, check=check)


e["fallas"] = [
    falla("filtro-despues", "Ana pregunta por cuentas duplicadas y el asistente dice que no hay nada", "config",
          "Para que la búsqueda «no revise permisos de chunks que nunca van a salir», alguien movió el filtro de permisos a después de elegir los 8 mejores. Nadie ve nada raro: nadie recibe un chunk ajeno.",
          "<code>verificar.py filtro</code> falla: <code>buscar()</code> devuelve menos chunks de los que la persona podía ver. <code>fuga</code> pasa: no hay nada ajeno.",
          ["Ana perdió permisos.", "El top-k se elige entre todo el índice y después se filtra.", "El buscador ya no encuentra esas palabras."],
          cmd('python pipeline/buscar.py --como ana.ruiz@marketplace.test "Cuenta de vendedor duplicada"', F("fil ana"), "Ana ve 87 chunks y le llegan 0: los 8 mejores eran de fraude."),
          f"{CFG}, <code>busqueda.filtro</code> quedó en <code>despues</code>. Vuelve a <code>antes</code>; no hace falta reindexar. Filtrar después no filtra «de más»: deja vacío a quien ve poco, y el asistente contesta «no encontré información».",
          "pre-post-filtro", "filtro"),
    falla("acl-vieja", "A Hugo le quitaron las tarifas a las 9:07 y a las 9:50 todavía las consultaba", "config",
          "Para ahorrar llamadas, alguien puso el carril rápido a correr cada hora: «total, el reindexado ya corre cada hora». La mañana pasó sin errores.",
          "<code>verificar.py revocacion</code>: la revocación de las 9:07:20 se aplicó en 52 min 40 s. <code>fuga</code> pasa, porque a las 10:30 todo ya quedó bien.",
          ["El carril rápido no está corriendo a tiempo.", "El aviso del Drive llegó tarde.", "El reindexado deshizo la revocación."],
          cmd("python mundo/avanzar.py", F("vie manana"), "La mañana otra vez, con la configuración rota: todo se aplica a las 10:00."),
          f"{CFG}, <code>revocacion.cada_segundos</code> quedó en 3600. Vuelve a 60 y pasa la mañana otra vez (<code>python mundo/avanzar.py</code>). El periodo del carril sale del SLO: el aviso tarda 20 s, y aviso + periodo tiene que caber en 5 min.",
          "slo-revocacion", "revocacion"),
    falla("anidado", "Soporte dice que el asistente ya no sabe nada de devoluciones", "config",
          "Un ciclo en el directorio (el comité dentro del boletín y el boletín dentro del comité) colgó otro sistema de la empresa. Para que no pasara aquí, alguien bajó la profundidad de los grupos a 1.",
          "<code>verificar.py acceso</code>: a Ana le faltan 77 de sus 87 chunks. <code>fuga</code> pasa: nadie ve de más.",
          ["Los documentos de soporte cambiaron de ACL.", "Ana salió de soporte.", "Los grupos que están dentro de otros grupos ya no se resuelven."],
          cmd(P("ani ana", PROBARF), F("ani ana"), "Los principals de Ana: soporte-nivel1 sí, soporte no."),
          f"{CFG}, <code>directorio.profundidad</code> quedó en 1. Vuelve a 10. Un ciclo se resuelve llevando la cuenta de los grupos ya vistos, no cortando la profundidad: cortarla quita permisos legítimos y nadie ve un error.",
          "grupo-anidado", "acceso"),
    falla("sin-acl-publico", "Cualquiera puede preguntarle al asistente cuánto gana un líder de soporte", "infra",
          "Un script de migración del chunking reescribió dos archivos sin el campo acl. Ese mismo día, alguien cambió permisos.sin_acl a publico «para que los documentos nuevos no se queden fuera mientras llega su ACL».",
          "<code>verificar.py fuga</code> (Ana, y cualquiera del dominio, ve «Sueldos 2026») e <code>indice</code> (dos documentos sin ACL entraron con una ACL inventada).",
          ["Lucía compartió los sueldos con todos.", "Llegaron chunks sin ACL y el índice los hizo públicos.", "El filtro de permisos dejó de correr."],
          cmd('python pipeline/buscar.py --como diego.luna@marketplace.test "¿Cuánto gana un líder de soporte?"', F("pub diego"), "Diego, recién contratado, recibe «Sueldos 2026» como primera fuente."),
          f"Son dos arreglos. {CFG}, <code>permisos.sin_acl</code> vuelve a <code>rechazar</code> y <code>python pipeline/indexar.py</code>: la fuga se cierra, pero los dos documentos quedan fuera del asistente (fail-closed). Lo segundo es reparar la ACL de donde viene, el chunking: <code>python mundo/crear.py --rechunkear</code> hace de él, y otra vez <code>python pipeline/indexar.py</code>. Vacío no es público: es un dato que falta.",
          "fail-closed", "fuga"),
    falla("bitacora-borrada", "A las 10:30, Ana vuelve a ver un ticket que a las 9:31 pasó a «Solo líderes»", "infra",
          "En una limpieza de disco, alguien borró indice/acl_vigente.json: «son logs viejos del carril rápido». Una hora después corrió el reindexado de siempre, sin errores.",
          "<code>verificar.py fuga</code>: Ana ve <code>jira:SOP-14</code>. <code>indice</code> pasa: el índice coincide con <code>almacen/docs/</code>, y ese es justo el problema.",
          ["Alguien volvió a abrir el ticket.", "El reindexado reconstruyó con las ACL de las 9:05.", "El carril rápido dejó de correr."],
          cmd("python pipeline/revocar.py", F("bit carril"), "Correr el carril otra vez no basta: su cursor dice que ya aplicó los seis eventos."),
          "Se reconstruye y se vuelve a aplicar la cola desde el principio: <code>python pipeline/indexar.py --desde-cero</code> (borra también el cursor) y <code>python pipeline/revocar.py</code>. <code>acl_vigente.json</code> no es un log: es lo que impide que el reindexado deshaga una revocación.",
          "gana-la-nueva", "fuga"),
    falla("suscripcion-vencida", "Luis terminó su contrato a las 9:52 y a las 9:59 seguía consultando los manuales de soporte", "infra",
          "La suscripción del carril rápido a los avisos del directorio venció anoche y nadie la renovó. La mañana pasó sin errores: el carril corrió cada minuto, como siempre.",
          "<code>verificar.py revocacion</code>: la salida de Tomás de fraude (9:18:40) se aplicó en 41 min 20 s. <code>fuga</code> pasa: a las 10:30 todo quedó bien.",
          ["El carril rápido corre muy de vez en cuando.", "Los avisos del directorio no están llegando.", "El directorio no registró los cambios."],
          cmd("python mundo/avanzar.py", F("sus manana"), "La última línea lo dice: del directorio no llegó ningún aviso. Lo arregló el reindexado de las 10:00, que lee el directorio entero."),
          "En <code>almacen/suscripciones.json</code>, la del directorio está vencida. Se renueva (<code>python mundo/crear.py --suscribir</code> hace de renovarla en la consola del directorio) y se pasa la mañana otra vez. Pasa de verdad: un canal de avisos de Google Drive dura como máximo un día (una semana para la lista de cambios) y no se renueva solo, y las suscripciones de Microsoft Graph también vencen. Una alarma útil: ninguna fuente puede pasar una hora sin mandar avisos. Y el reindexado que lee el directorio entero es la red de seguridad: sin él, Luis seguiría viendo los manuales.",
          "carril-rapido", "revocacion"),
]

e["listo"] = [
    "Los principals de cada persona incluyen todos sus grupos, también los de adentro, y un ciclo no cuelga nada.",
    "La ACL se evalúa en cláusulas, y una ACL vacía o rota no deja ver a nadie.",
    "Cada chunk del índice lleva la ACL de su documento en grupos; lo que llega sin ACL se queda fuera.",
    "El top-k sale solo de lo que la persona puede ver, y otro filtro revisa cada chunk antes del prompt.",
    "La prueba de permisos pasa para cada persona: ni un chunk de más, ni uno de menos.",
    "Cada revocación se aplica en ≤ 5 min por el carril rápido, y el reindexado no la deshace.",
]

e["repaso"] = {
    "memo": "<b>El permiso viaja dentro de cada chunk, en grupos; la persona se resuelve al preguntar; el filtro va antes del top-k y otra vez antes del prompt; y una revocación no espera al reindexado.</b> Los grupos se resuelven con todos sus niveles, llevando la cuenta de lo ya visto. Sin ACL, nadie. El carril rápido aplica cada aviso en segundos, anota la hora del cambio en la fuente, y esa hora gana cuando el reindexado trae la ACL vieja.",
    "trampa": "Un sistema de permisos que «funciona» porque nadie se queja. El post-filter nunca da un chunk ajeno, pero deja a quien ve poco sin respuesta. Cortar los grupos anidados no da errores, solo un asistente que no sabe nada. Un carril que corre cada hora deja todo bien a las 10:30 y aun así alguien leyó 52 minutos lo que ya no debía. Por eso se mide como cada persona y minuto a minuto. OWASP lo pone en su Top 10 de aplicaciones con LLM (LLM08:2025): controles de acceso finos y almacenes de vectores que respeten permisos.",
    "entrevista": [
        {"q": "¿Cómo haces que un RAG respete los permisos de cada persona?", "a": "La ACL de cada documento viaja dentro de cada uno de sus chunks del índice, con los grupos tal como vienen de la fuente. Al preguntar, resuelvo los principals de la persona (su usuario, su dominio y todos sus grupos, también los anidados) con una copia del directorio, y el filtro va dentro de la búsqueda, antes del top-k. Justo antes de armar el prompt reviso otra vez cada chunk contra la ACL del índice. Y lo pruebo: cada persona contra la verdad, en el gate y en producción."},
        {"q": "¿Guardas en cada chunk la lista de personas o los grupos?", "a": "Los grupos. Expandir a personas multiplica el tamaño (en mi caso, 19 principals contra 952 entradas; con grupos de cientos de personas, cientos de veces más) y, sobre todo, cada alta o baja de un grupo obliga a reescribir todos los chunks que lo nombran. Con grupos, un cambio de equipo es una línea en el directorio."},
        {"q": "¿Por qué no filtrar por permisos después de traer el top-k?", "a": "Porque el top-k se llena con chunks que la persona no puede ver y, al quitarlos, le queda poco o nada. No hay fuga, pero el asistente contesta «no encontré información». Pega más a quien ve menos: alguien que ve el 2 % del corpus recibe en promedio 0.16 de 8. El filtro va dentro de la búsqueda."},
        {"q": "Le quitan a alguien el acceso a un documento. ¿Cuánto tarda en dejar de verlo en el asistente?", "a": "Mi objetivo son ≤ 5 min. Las fuentes avisan con webhooks a una cola, y un carril rápido aplica el cambio en el índice (solo la ACL de los chunks de ese documento, sin reindexar) o en la copia del directorio si es un cambio de grupo. Lo mido como exposición: de que cambió en la fuente a que la persona deja de recibirlo. Y el reindexado no puede deshacerlo: gana la ACL con la hora de cambio más nueva."},
        {"q": "¿Qué haces con un documento que llega sin ACL?", "a": "No entra al índice: fail-closed. Vacío no es público, es un dato que falta. El documento se queda fuera del asistente hasta que se repare de donde viene, y una alarma lo avisa. Un default de «público mientras llega su ACL» es justo la forma de que todos lean los sueldos."},
    ],
}

e["prompts"] = {
    "claude_md": "kits/rag-permisos/CLAUDE.md",
    "guiado": "content/estaciones/rag-permisos/prompts/guiado.md",
    "solo": "content/estaciones/rag-permisos/prompts/solo.md",
    "romper_ayuda": "content/estaciones/rag-permisos/prompts/romper-ayuda.md",
    "romper_solo": "content/estaciones/rag-permisos/prompts/romper-solo.md",
}

(APP / "content/estaciones/rag-permisos.json").write_text(json.dumps(e, ensure_ascii=False, indent=2) + "\n")
print("ok", len(json.dumps(e, ensure_ascii=False)))
