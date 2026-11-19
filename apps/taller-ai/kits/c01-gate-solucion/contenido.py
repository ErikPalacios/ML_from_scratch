"""Arma content/estaciones/c01-gate.json con las salidas reales de probar.sh y probar-fallas.sh.

    bash probar.sh /tmp/e4 && bash probar-fallas.sh /tmp/e4     # deja /tmp/e4.log y /tmp/e4-fallas.log
    python3 contenido.py /tmp/e4                                 # escribe el JSON con esas salidas

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
    lineas = m.group(1).rstrip("\n").replace(RUTA, "~/c01-gate").splitlines()
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
G_ = "pipeline/gate.py"
T_CAND = num("p2 evaluar", r"candidato\s+top-1 (\S+)%")
T_CHAMP = num("p2 evaluar", r"champion\s+top-1 (\S+)%")
T_H3 = num("p2 evaluar", r"hace_3_meses\s+top-1 (\S+)%")
B = num("p3 gate", r"vs champion\s+top-1: b\s+(\d+)")
C = num("p3 gate", r"vs champion\s+top-1: b\s+\d+ · c\s+(\d+)")
DMIN = num("p3 gate", r"vs champion\s+top-1: .*Δmin (\S+)")
SE = num("p3 gate", r"vs champion\s+top-1: .*SE (\S+)")
P_CAM = num("p5 gate", r"p de Holm (\S+)\)")
CREAR_S = num("p0 crear", r"(?m)^real (\d+)")
PARES_KB = num("p2 pares", r"· (\d+) kB")
DISC = int(B) + int(C)

e = {
    "id": "gate", "patron": "sincrono", "caso": "c01", "num": 4,
    "titulo": "Gate de evaluación y registry", "nav": "Gate y registry",
    "pregunta": "¿Quién decide, y con qué números, que el modelo nuevo puede reemplazar al de producción?",
    "version": "2026-11-17",
}

e["mapa"] = {
    "resumen": "La estación 3 deja un <b>checkpoint candidato</b> con su corrida en MLflow. Esta decide si puede reemplazar al modelo que hoy atiende en producción (el <b>champion</b>), y no lo decide una persona viendo una gráfica: lo decide un <b>gate</b>, un paso automático del pipeline con reglas escritas antes de la corrida. El gate evalúa al candidato, al champion y al champion de hace 3 meses sobre el mismo <b>examen congelado</b> (el golden set), foto por foto. Pide que el candidato no sea peor por más de un margen (<b>no inferioridad</b>), que ninguna categoría se rompa, que ningún slice caiga y que su confianza diga la verdad. Si algo no se cumple, el pipeline se pone en rojo. Si todo pasa, el candidato queda en el <b>registry</b> como una versión nueva con el alias <code>challenger</code>. <code>champion</code> se mueve después, cuando termina el canary.",
    "entra": [
        "el checkpoint candidato: la corrida de MLflow que dejó la estación 3",
        "el champion y el de hace 3 meses, por su <b>número</b> de versión (los resolvió el orquestador al arrancar)",
        "el golden set congelado, con la huella de su manifest",
        "las reglas del gate (<code>gate.yaml</code>), revisadas en un PR antes de la corrida",
    ],
    "sale": [
        "las predicciones de los tres modelos, foto por foto (los pares)",
        "el reporte del gate: veredicto, motivo, no inferioridad, categorías, slices y calibración, en una corrida de MLflow",
        "si pasa: una versión nueva de <code>classifier</code> con el alias <code>challenger</code> y sus tags; si no, una corrida roja que frena el pipeline",
    ],
    "escala": [
        {"que": "El examen", "c01": "<code>golden-v3</code>: 50,000 fotos", "taller": "<code>golden-v1</code>: 1,000 fotos (las que la estación 3 dejó fuera de los snapshots), 600 normales, 210 con poca luz y 190 chicas"},
        {"que": "Categorías", "c01": "500; el gate revisa por separado las 100 con más tráfico", "taller": "10, todas"},
        {"que": "Margen de no inferioridad", "c01": "0.3 puntos", "taller": "2.4 puntos (el ruido de un examen de 1,000 fotos)"},
        {"que": "Contra quién", "c01": "el champion (v14) y el de hace 3 meses (v12)", "taller": "el champion (v3, septiembre) y el de hace 3 meses (v1, julio)"},
        {"que": "Dónde corre", "c01": "un paso del pipeline en una GPU (evaluar) y otro en CPU (el gate)", "taller": f"la CPU de tu Mac: evaluar ≈ 10 s, el gate ≈ 3 s"},
        {"que": "Las reglas", "c01": "<code>gate.yaml</code> en el repositorio <code>ml-catalogo</code>; cambian solo en un PR revisado", "taller": "<code>gate.yaml</code> en tu carpeta; sus versiones revisadas, en <code>mundo/revisiones.json</code>"},
        {"que": "El registry", "c01": "MLflow con Postgres y S3", "taller": "MLflow en Docker, con SQLite y un volumen"},
    ],
    "hoja": "https://hojas.trueml.app/recorrido/#est-gate",
}

e["precalculos"] = {
    "intro": "Antes de escribir el gate, las cuentas de servilleta: cuánto ruido tiene el examen (de ahí sale el margen), qué tan fina es la comparación foto por foto, cuánto ruido tiene una sola categoría, por qué hay que corregir cuando se hacen 10 pruebas a la vez, cuánto pesa la tabla de pares y cuánta erosión se puede colar. Cada cuenta va en las dos escalas: C01 y el dojo.",
    "cuentas": [
        {
            "id": "margen", "pregunta": "¿De qué tamaño es el margen de no inferioridad?",
            "formula": "E = 1.96 × √(q × (1 − q) ÷ N) × 100, en puntos; el margen m es E redondeado",
            "c01": {"cuenta": "q = 0.85, N = 50,000: 1.96 × √(0.85 × 0.15 ÷ 50,000) × 100", "valor": "≈ 0.31 → m = 0.3 puntos"},
            "taller": {"cuenta": "q = 0.82, N = 1,000: 1.96 × √(0.82 × 0.18 ÷ 1,000) × 100", "valor": "≈ 2.38 → m = 2.4 puntos"},
            "decide": "El margen es lo que el examen ni siquiera puede medir de un modelo solo. Perder menos que eso es perder menos de lo que se ve. Con 1,000 fotos, el dojo solo puede proteger contra pérdidas de más de ≈ 2.4 puntos; C01, con 50,000, contra 0.3. Un examen más grande es un gate más fino.",
            "conceptos": ["margen", "no-inferioridad"],
            "comprueba": cmd("python -c \"\nimport math\nfor nombre, q, N in [('C01, golden de 50,000', 0.85, 50000), ('dojo, golden de 1,000', 0.82, 1000)]:\n    print(f'{nombre}: E = 1.96 × √({q} × {1 - q:.2f} ÷ {N:,}) × 100 = {196 * math.sqrt(q * (1 - q) / N):.2f} puntos')\"", L("pc margen")),
        },
        {
            "id": "pareado", "pregunta": "¿Qué tan fina es la comparación foto por foto?",
            "formula": "SE_Δ = √(b + c) ÷ N × 100, donde b + c son las fotos en que los dos modelos discrepan",
            "c01": {"cuenta": "2,100 discrepancias de 50,000: √2,100 ÷ 50,000 × 100", "valor": "≈ 0.09 puntos (intervalo ± 0.18)"},
            "taller": {"cuenta": f"{DISC} discrepancias de 1,000 (b = {B}, c = {C}): √{DISC} ÷ 1,000 × 100", "valor": f"≈ {SE} puntos (intervalo ± {1.96 * float(SE):.2f})"},
            "decide": "Las fotos que los dos aciertan o los dos fallan no mueven la diferencia: solo cuentan las que discrepan. Por eso la comparación pareada es más fina que el margen y el gate puede leer pérdidas más chicas que el ruido de un modelo solo.",
            "conceptos": ["pares", "intervalo"],
            "confirma": f"el paso 3: contra el champion salen b = {B} y c = {C}, SE = {SE}.",
        },
        {
            "id": "categoria", "pregunta": "¿Cuánto ruido tiene el recall de una sola categoría?",
            "formula": "E = 1.96 × √(r × (1 − r) ÷ n) × 100, con n las fotos de esa categoría",
            "c01": {"cuenta": "una de las 100 grandes, con ≈ 500 fotos y r = 0.85: 1.96 × √(0.85 × 0.15 ÷ 500) × 100", "valor": "≈ 3.1 puntos"},
            "taller": {"cuenta": "≈ 100 fotos por categoría y r = 0.85: 1.96 × √(0.85 × 0.15 ÷ 100) × 100", "valor": "≈ 7 puntos"},
            "decide": "Una caída de 5 puntos en una categoría puede ser azar. Por eso la regla pide dos cosas: que caiga más de 5 puntos <b>y</b> que la caída sea significativa con McNemar, que usa los pares de esa categoría.",
            "conceptos": ["mcnemar"],
            "comprueba": cmd("python -c \"\nimport math\nprint(f'una categoría con 100 fotos y recall 0.85: E = 1.96 × √(0.85 × 0.15 ÷ 100) × 100 = {196 * math.sqrt(0.85 * 0.15 / 100):.1f} puntos')\"", L("pc categoria")),
        },
        {
            "id": "holm", "pregunta": "Si haces 10 pruebas a la vez, ¿cuántas falsas alarmas esperas?",
            "formula": "P(al menos una falsa alarma) = 1 − (1 − α)^k, con k pruebas y α = 0.05",
            "c01": {"cuenta": "100 categorías: 1 − 0.95^100", "valor": "≈ 99 %"},
            "taller": {"cuenta": "10 categorías: 1 − 0.95^10", "valor": "≈ 40 %"},
            "decide": "Sin corregir, el gate frenaría a un modelo sano casi siempre: con 10 pruebas, 4 de cada 10 meses alguna «cae» por azar. La corrección de Holm vuelve a dejar la falsa alarma del gate completo en 5 %.",
            "conceptos": ["holm"],
            "comprueba": cmd("python -c \"\nfor k in (10, 100):\n    print(f'{k} pruebas con α = 0.05 y ninguna diferencia real: P(al menos una falsa alarma) = 1 − 0.95^{k} = {1 - 0.95 ** k:.1%}')\"", L("pc holm")),
        },
        {
            "id": "tabla", "pregunta": "¿Cuánto pesa guardar las predicciones foto por foto?",
            "formula": "filas = modelos × fotos; cada fila, el top-5 y la confianza",
            "c01": {"cuenta": "3 modelos × 50,000 fotos = 150,000 filas", "valor": "≈ 5–10 MB en Parquet"},
            "taller": {"cuenta": "1,000 fotos, una fila con las 3 columnas de cada modelo", "valor": f"≈ {PARES_KB} kB"},
            "decide": "Guardar los pares es casi gratis, y sin ellos no hay prueba pareada, ni categorías, ni slices: solo dos promedios que no dicen en qué fotos discrepan. Se guardan siempre, con la corrida del gate.",
            "conceptos": ["pares"],
            "confirma": f"el paso 2: <code>reportes/cand-2026-10-01/pares.parquet</code> pesa ≈ {PARES_KB} kB.",
        },
        {
            "id": "erosion", "pregunta": "¿Cuánta erosión se cuela si solo comparas contra el champion?",
            "formula": "cada mes pasa si la pérdida r cumple r + 1.96 × SE_Δ ≤ m; en 12 meses se acumulan 12 × r",
            "c01": {"cuenta": "r = 0.2 puntos al mes, SE_Δ ≈ 0.045: cada mes pasa; 12 × 0.2", "valor": "2.4 puntos al año, sin un solo gate en rojo"},
            "taller": {"cuenta": f"m = 2.4, SE_Δ ≈ {SE}: pasa cada mes cualquier r ≤ 2.4 − 1.96 × {SE}", "valor": f"≈ {2.4 - 1.96 * float(SE):.1f} puntos al mes"},
            "decide": "Por eso el gate también compara contra el champion de hace 3 meses, con la misma regla: contra él se suman tres meses de pérdida, que ya no caben en el margen.",
            "conceptos": ["erosion"],
            "confirma": f"el paso 3: contra el de hace 3 meses (v1) el candidato está {float(T_CAND) - float(T_H3):+.1f} puntos arriba; aquí no hubo erosión.",
        },
    ],
}

conceptos = [
    {"id": "gate", "termino": "Gate de evaluación", "en": "evaluation gate",
     "def": "Un paso automático del pipeline que decide si un modelo puede avanzar, con reglas escritas antes. Si no se cumplen, el pipeline se detiene.",
     "analogia": "El examen de manejo: hay una lista de cosas que tienes que hacer bien, escrita antes de que te subas al coche, y el examinador no la cambia porque le caíste bien.",
     "importa": "Sin gate, el modelo nuevo llega a producción porque «se ve bien» en una gráfica. Con gate, cada mes se aplica la misma regla, y el historial dice por qué pasó o no pasó cada modelo.",
     "trampa": "Un gate que solo mira el promedio global: una categoría rota se esconde detrás de 9 que mejoraron un poco."},
    {"id": "golden", "termino": "Golden set (examen congelado)", "en": "golden set / frozen test set",
     "def": "Un conjunto fijo de fotos con etiquetas revisadas, que ningún entrenamiento ve y que no cambia. Se identifica por su id y por la huella (sha256) de su manifest.",
     "analogia": "El metro patrón de París: si cada quien ajusta su metro, ya nadie mide lo mismo.",
     "importa": "Solo con el mismo examen se pueden comparar modelos de meses distintos. Si se corrige algo, se publica <code>golden-v2</code> en un PR propio y todos se vuelven a medir con él.",
     "trampa": "«Corregir» unas etiquetas del examen sin cambiarle el nombre: la comparación con los meses anteriores deja de valer y nadie lo nota."},
    {"id": "champion", "termino": "Champion y challenger", "en": "champion / challenger",
     "def": "Champion: el modelo que hoy atiende en producción. Challenger: el que pasó el gate y espera su turno (shadow y canary) para reemplazarlo.",
     "analogia": "El campeón de box y el retador: el retador tiene que ganarse la pelea; no basta con decir que está mejor entrenado.",
     "importa": "Los dos son alias en el registry, nombres que apuntan a una versión. Cambiar de modelo, o volver atrás, es mover un alias, no reentrenar.",
     "trampa": "Mover champion a mano «porque ya lo probé en el notebook»: el alias se mueve, pero nadie aprobó ese modelo."},
    {"id": "registry", "termino": "Registro de modelos", "en": "model registry",
     "def": "El catálogo de modelos: cada versión (v1, v2…) apunta a sus archivos y nunca cambia; los alias (champion, challenger) se mueven; los tags guardan de dónde salió.",
     "analogia": "El registro civil: cada acta tiene su número y no se reescribe; lo que cambia es quién ocupa qué puesto.",
     "importa": "La pregunta de la guardia a las 3 de la mañana, «¿qué modelo está sirviendo y de dónde salió?», se contesta con el alias y los tags, en un minuto.",
     "trampa": "Creer que los archivos de una corrida no cambian: en MLflow se pueden reemplazar. Por eso la versión guarda las huellas (pesos_sha256, labels_sha256)."},
    {"id": "version-numero", "termino": "Versión por número", "en": "pinned version",
     "def": "El gate recibe el champion como número (v3), resuelto una sola vez al arrancar, nunca como la pregunta «¿quién es champion?».",
     "analogia": "Comparar contra «el récord de hoy» a media carrera es trampa: el récord puede cambiar mientras corres.",
     "importa": "Si el alias se mueve a mitad de la corrida, las predicciones serían de un modelo y el veredicto contra otro. Con el número, el reporte dice exactamente contra quién se comparó.",
     "trampa": "Registrar el veredicto de un gate que comparó contra un champion que ya no es champion: es un veredicto viejo."},
    {"id": "no-inferioridad", "termino": "No inferioridad", "en": "non-inferiority test",
     "def": "Pedir que el modelo nuevo no sea peor que el actual por más de un margen, con buena seguridad. No se le pide ganar.",
     "analogia": "Un medicamento genérico más barato: no tiene que curar más que el original, solo no curar menos por más de un margen chico.",
     "importa": "El reentrenamiento mensual busca estar al día, no ganar. Exigir «mejor de forma significativa» bloquearía casi todos los meses; exigir «≥ champion» decidiría con una moneda.",
     "trampa": "Mirar el centro (Δ) en vez del extremo de abajo (Δmin): un Δ de −0.5 puede pasar o no según cuánto ruido haya."},
    {"id": "margen", "termino": "Margen de no inferioridad", "en": "non-inferiority margin",
     "def": "Cuánto se acepta que el modelo nuevo pierda contra el actual. Se fija antes, del tamaño del ruido del examen: lo que el examen ni siquiera puede medir.",
     "analogia": "La tolerancia de una báscula: si mide de ± 100 g, no tiene caso discutir por 50.",
     "importa": "En C01, 0.3 puntos (golden de 50,000). En el dojo, 2.4 (golden de 1,000). Es una decisión de negocio vestida de estadística: en C01, con ≈ 10 millones de fotos al día, 0.3 puntos son ≈ 30,000 primeras sugerencias equivocadas más al día.",
     "trampa": "Elegirlo después de ver el resultado. Entonces ya no mide: justifica."},
    {"id": "pares", "termino": "Evaluación pareada", "en": "paired evaluation",
     "def": "Los dos modelos responden las mismas fotos y se comparan foto por foto: b = solo el nuevo acierta, c = solo el viejo acierta.",
     "analogia": "Dos cocineros preparan los mismos 1,000 platillos; para saber quién es mejor, solo importan los platillos en que uno acertó y el otro no.",
     "importa": "Las fotos fáciles (los dos aciertan) y las imposibles (los dos fallan) no dicen nada; solo las discrepancias. Por eso la comparación pareada es más fina que comparar dos promedios.",
     "trampa": "Guardar solo «83.2 % vs 81.7 %»: sin los pares no hay prueba pareada, ni categorías, ni slices."},
    {"id": "intervalo", "termino": "Error estándar e intervalo", "en": "standard error / confidence interval",
     "def": "SE_Δ dice cuánto se movería la diferencia por azar con otras fotos. Δmin = Δ − 1.96 × SE es el extremo de abajo del intervalo de 95 %: lo peor que puede ser, con buena seguridad.",
     "analogia": "El margen de error de una encuesta: «42 % ± 3» quiere decir que lo real está, casi seguro, entre 39 y 45.",
     "importa": "La regla del gate es Δmin ≥ −margen. Con pocas discrepancias el intervalo es estrecho; con muchas, ancho.",
     "trampa": "Confundir el SE de un modelo solo (el del margen) con el SE pareado (el de la diferencia): el segundo es más chico."},
    {"id": "erosion", "termino": "Erosión de calidad", "en": "slow regression",
     "def": "Perder un poco cada mes, siempre dentro del margen: cada comparación pasa, y la suma de un año es grande.",
     "analogia": "La rana en el agua que se calienta despacio: ningún grado de más se nota, la suma sí.",
     "importa": "Por eso el gate compara también contra el champion de hace 3 meses: contra él se suman tres meses de pérdida, que no caben en el margen.",
     "trampa": "Comparar solo contra el mes anterior y creer que eso protege del largo plazo."},
    {"id": "mcnemar", "termino": "Prueba de McNemar", "en": "McNemar's test",
     "def": "Para dos modelos sobre las mismas fotos: si fueran igual de buenos, cada discrepancia sería un volado. La prueba da la probabilidad (p) de ver un reparto tan desigual de b y c por azar.",
     "analogia": "Si una moneda sale 21 veces cruz y 2 águila, sospechas que está cargada: es muy raro por azar.",
     "importa": "Separa una categoría rota (camisas: 2 contra 21) del ruido (playeras: 1 contra 4). Usa solo las discrepancias de esa categoría.",
     "trampa": "Usarla con muy pocas discrepancias y concluir «no hay diferencia»: con 3 discrepancias, ninguna prueba puede ver nada."},
    {"id": "holm", "termino": "Corrección de Holm", "en": "Holm–Bonferroni correction",
     "def": "Al hacer k pruebas a la vez, ordena las p de menor a mayor y compara la primera contra α/k, la segunda contra α/(k − 1)… Así la falsa alarma de todo el conjunto queda en α.",
     "analogia": "Si compras 10 boletos de lotería, ganar uno ya no es tan sorprendente: hay que pedir más para creer que no fue suerte.",
     "importa": "Con 10 categorías y α = 0.05 sin corregir, ≈ 40 % de los meses alguna «cae» por azar y el gate frena a un modelo sano.",
     "trampa": "No corregir porque «cada prueba es al 5 %»: el 5 % es por prueba, no por gate."},
    {"id": "slice", "termino": "Slice", "en": "data slice",
     "def": "Un pedazo del examen con algo en común: fotos con poca luz, fotos chicas, fotos del celular. Se evalúa aparte porque un promedio lo puede esconder.",
     "analogia": "Un restaurante con 4.5 estrellas que da intoxicación los martes: el promedio no lo dice, el corte por día sí.",
     "importa": "El candidato del proveedor no se ve tan mal en global (−1.3 puntos) y en poca luz su Δmin cae a −5.5: ahí es donde más se nota el lote malo.",
     "trampa": "Usar el margen global en un slice chico: con 200 fotos el ruido es ≈ 5 puntos, y el gate se pondría en rojo por azar."},
    {"id": "calibracion", "termino": "Calibración (ECE)", "en": "calibration / expected calibration error",
     "def": "Si el modelo dice «90 % seguro», ¿acierta 9 de cada 10? El ECE agrupa las fotos por confianza y promedia la distancia entre confianza y aciertos.",
     "analogia": "Un pronóstico del clima que dice «70 % de lluvia» y llueve 7 de cada 10 de esos días está bien calibrado.",
     "importa": "Producto usa la confianza (por ejemplo, para pedir revisión humana debajo de un umbral). Un modelo que acierta igual pero dice «99 %» siempre rompe esa regla.",
     "trampa": "Mirar solo la exactitud: dos modelos con el mismo top-1 pueden tener calibraciones muy distintas."},
    {"id": "fuga", "termino": "Fuga hacia el examen", "en": "data leakage / test contamination",
     "def": "Que fotos del examen terminen en los datos de entrenamiento. El modelo ya vio las respuestas: sale mejor en el examen sin ser mejor.",
     "analogia": "Estudiar con el examen que te van a poner: sacas 10 y no aprendiste nada.",
     "importa": "El gate cruza las huellas del snapshot del candidato con las del examen y se detiene si hay una sola en común. La estación 2 deja el golden set fuera por diseño.",
     "trampa": "Celebrar un candidato que «sube 3 puntos» sin preguntar con qué datos se entrenó."},
    {"id": "labels-json", "termino": "labels.json: el orden es parte del modelo", "en": "label map",
     "def": "La lista que dice qué categoría es cada salida de la red: la salida 0 es «playeras», la 1 «pantalones»… Viaja con los pesos y se registra con su huella.",
     "analogia": "Las etiquetas de los frascos de la cocina: si las revuelves, el azúcar sigue siendo azúcar, pero le pones sal al café.",
     "importa": "Con otro orden, los números del gate salen iguales (se evalúa por índice) y el gateway muestra otra categoría. Solo se nota si se compara el labels.json, o cuando cae la aceptación.",
     "trampa": "Ordenar las categorías alfabéticamente «para que se vea limpio»."},
    {"id": "reglas-antes", "termino": "Reglas escritas antes", "en": "pre-registered thresholds",
     "def": "Los umbrales del gate viven en un archivo versionado y cambian solo en un PR propio, revisado por otra persona, antes de la corrida.",
     "analogia": "Las reglas del partido se acuerdan antes del silbatazo, no al medio tiempo cuando vas perdiendo.",
     "importa": "Si se pueden mover después de ver el resultado, cada mes habrá un argumento razonable para aflojar, y el gate deja de medir.",
     "trampa": "«Solo por esta vez»: el commit directo a main que afloja una regla para que salga el modelo de la semana."},
    {"id": "falla-ruidosa", "termino": "Fallar en rojo", "en": "fail loudly",
     "def": "Si el gate no pasa, el paso termina con error (código de salida 1, corrida FAILED) y el pipeline se detiene y avisa. Nunca devuelve «false» y deja seguir.",
     "analogia": "Una alarma de incendio que en vez de sonar escribe una nota en un cuaderno: técnicamente detectó el fuego.",
     "importa": "Un gate que «devuelve false» deja que los pasos siguientes se salten en silencio: la corrida queda en verde, no aparece ningún challenger y nadie se entera.",
     "trampa": "Atrapar la excepción del gate «para que el pipeline no truene»."},
]
e["conceptos"] = conceptos

e["mundo"] = {
    "resumen": "El kit trae el marketplace de C01 el 1 de octubre de 2026, a las 05:00 UTC: el entrenamiento del mes ya terminó y el pipeline llega al gate. En el S3 local están las fotos, los snapshots de junio a septiembre y el examen congelado <code>golden-v1</code>. En MLflow está el historial del registro (julio, agosto y septiembre, que hoy es champion) y dos candidatos de octubre: el bueno y uno entrenado con un lote de etiquetas malo del proveedor. Tú escribes el gate: evaluar a los tres modelos foto por foto, aplicar las reglas y registrar al challenger. Todo corre con un entorno virtual de Python y dos contenedores.",
    "trae": [
        {"que": "El S3 local y MLflow (compose.yaml)", "detalle": "RustFS en el puerto 9500 (buckets <code>fotos</code> y <code>ml-datos</code>, este con versionado) y MLflow en el 5500, con su interfaz."},
        {"que": "mundo/crear.py", "detalle": f"Crea todo en ≈ {round(int(CREAR_S) / 60)} minutos: baja Fashion-MNIST, sube las 10,000 fotos, publica 4 snapshots, congela <code>golden-v1</code> (1,000 fotos con su slice), entrena <code>classifier</code> v1, v2 y v3 (<code>@champion</code>) y los dos candidatos, y escribe <code>corrida.yaml</code>."},
        {"que": "gate.yaml y mundo/revisiones.json", "detalle": "Las reglas del gate (el examen y su huella, contra quién, el margen, categorías, slices y calibración) y el registro de sus versiones revisadas: el sustituto del historial de PR."},
        {"que": "corrida.yaml", "detalle": "Los parámetros de esta noche, ya resueltos: el candidato, champion = 3 y hace_3_meses = 1."},
        {"que": "mundo/gateway/ y mundo/arquitectura.py", "detalle": "El preprocess del gateway (el mismo de la estación 3) y la red."},
        {"que": "mundo/modelos.py y mundo/s3.py", "detalle": "Mirar y reparar el registro (versiones, alias, candidatos, gates, labels) y el S3 (el examen, sus versiones y restaurar una)."},
        {"que": "verificar.py y romper.py", "detalle": "10 checks con los criterios de «listo» y 6 fallas en el mundo, la configuración o la infraestructura, nunca en lo que escribes."},
    ],
    "tu_pipeline": [
        {"archivo": "pipeline/evaluar.py", "hace": "Los tres modelos por número, con sus huellas, sobre el examen congelado (sin fuga): los pares, foto por foto."},
        {"archivo": "pipeline/gate.py", "hace": "Las reglas revisadas: no inferioridad pareada, categorías con McNemar y Holm, slices y ECE. Si no pasa, en rojo."},
        {"archivo": "pipeline/registrar.py", "hace": "Solo con un gate que pasó: la versión nueva con sus tags y el alias challenger."},
    ],
    "requisitos": [
        "Docker Desktop corriendo, con ≈ 700 MB libres para las imágenes de RustFS y MLflow",
        "Python 3.11 o más nuevo (se probó con 3.14.3) y ≈ 1.1 GB para el entorno virtual (PyTorch)",
        "git (con tu nombre y correo configurados)",
        "Internet la primera vez (los paquetes, las imágenes y Fashion-MNIST)",
        "Los puertos 9500, 9501 y 5500 libres en tu Mac",
    ],
    "sustituciones": [
        {"nube": "<code>golden-v3</code>: 50,000 fotos, 500 categorías", "local": "<code>golden-v1</code>: 1,000 fotos, 10 categorías", "diferencia": "Las mismas reglas con otra escala: el margen sale de la misma fórmula (2.4 puntos en lugar de 0.3) y cada categoría tiene ≈ 100 fotos."},
        {"nube": "El historial de PR del repositorio <code>ml-catalogo</code>", "local": "<code>mundo/revisiones.json</code>", "diferencia": "En C01, la rama protegida no deja subir <code>gate.yaml</code> sin revisión; aquí el gate comprueba la huella contra la lista de versiones aprobadas."},
        {"nube": "Los parámetros de la corrida de Argo", "local": "<code>corrida.yaml</code>", "diferencia": "Los dos traen el champion ya resuelto a un número. El de verdad lo escribe el orquestador; el del dojo lo escribe <code>mundo/crear.py</code>."},
        {"nube": "Registrar después de la estación 5 (paridad y latencia del engine)", "local": "<code>registrar.py</code> justo después del gate", "diferencia": "En el dojo no hay engine: el challenger se registra en cuanto pasa el gate. En C01, primero se construye y se prueba el engine."},
        {"nube": "Evaluar en una GPU", "local": "La CPU de tu Mac", "diferencia": "1,000 fotos de 32×32 caben en segundos; 50,000 de 224×224 con una ResNet-50, en minutos de GPU."},
        {"nube": "MLflow con Postgres y S3; Amazon S3", "local": "MLflow con SQLite; RustFS en localhost:9500", "diferencia": "La misma API y la misma interfaz."},
    ],
    "arranque": "unzip c01-gate.zip && cd c01-gate\npython3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt\ndocker compose up -d --wait\npython mundo/crear.py\ngit init && git add -A && git commit -m \"kit recién descomprimido\"\npython verificar.py mundo",
    "python": "python",
}

G = []
G.append(dict(n=0, id="mundo", titulo="Levantar el mundo", objetivo="El S3 local y MLflow arriba, el mundo creado y la carpeta como repositorio de git.",
    conceptos=["registry"],
    explica="El mundo vive en dos servicios: el S3 local (fotos, snapshots y el examen) y MLflow (las corridas y el registro de modelos). <code>mundo/crear.py</code> los llena igual cada vez y entrena los cinco modelos del equipo, por eso tarda unos minutos. La carpeta tiene que ser un repositorio de git: el gate se niega a juzgar con reglas que no están en un commit.",
    codigo=[],
    comandos=[
        cmd("python3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt", L("p0 venv"), "Tarda unos minutos la primera vez (PyTorch pesa ≈ 1 GB). Desde aquí, cada terminal nueva necesita <code>source .venv/bin/activate</code>."),
        cmd("docker compose up -d --wait\npython mundo/crear.py", L("p0 up") + "\n" + L("p0 crear", quitar=r"^(real|user|sys) "), "La interfaz de MLflow queda en http://localhost:5500: ahí están las corridas del equipo y el modelo <code>classifier</code>."),
        cmd("git init && git add -A && git commit -m \"kit recién descomprimido\"\ngit log --oneline", L("p0 git"), "Los ids de commit cambian en cada máquina."),
        cmd(f"{V} mundo", L("p0 verificar")),
    ],
    verifica="<code>verificar.py mundo</code> en verde: los buckets, los snapshots, el examen, <code>classifier</code> v1–v3 con <code>@champion</code>, los dos candidatos y git.",
    ojo="El 5000 lo ocupa AirPlay en macOS: por eso MLflow está en el 5500 (y el S3 en 9500, para no chocar con las estaciones anteriores)."))

G.append(dict(n=1, id="reglas", titulo="Las reglas y los parámetros de esta noche", objetivo="Saber, antes de escribir código, contra quién se compara, con qué examen y con qué reglas.",
    conceptos=["gate", "champion", "version-numero", "golden", "reglas-antes"],
    explica="El gate no decide nada que no esté escrito. <code>corrida.yaml</code> trae lo que resolvió el orquestador al arrancar: el candidato y los dos modelos de referencia, <b>por número</b>. <code>gate.yaml</code> trae las reglas: el examen y la huella de su manifest, contra quién se compara y cuánto puede moverse cada cosa. Fíjate en que no dice «el top-1 debe ser 85 %»: dice contra quién y cuánto. Un número absoluto envejece; una comparación contra el que ya está sigue teniendo sentido cada mes.",
    codigo=[{"lang": "yaml", "path": "gate.yaml", "code": (APP / "kits/c01-gate/gate.yaml").read_text().rstrip(), "nota": "Del equipo. Sus versiones revisadas están en <code>mundo/revisiones.json</code>: el gate comprueba que la de hoy sea una de ellas."}],
    comandos=[
        cmd("grep -v \"^#\" corrida.yaml", L("p1 corrida")),
        cmd("python mundo/modelos.py versiones", L("p1 versiones"), "El historial del registro: tres meses, cada uno aprobado por su gate."),
        cmd("python mundo/modelos.py candidatos", L("p1 candidatos"), "Los dos candidatos de octubre están en el experimento de entrenamiento, sin registrar."),
        cmd("python mundo/s3.py golden", L("p1 golden")),
    ],
    verifica="Puedes decir en voz alta: candidato <code>cand-2026-10-01</code>, contra v3 y v1, con <code>golden-v1</code> (1,000 fotos, huella <code>0061343a…</code>) y margen de 2.4 puntos.",
    ojo="Las «val_top1» de <code>candidatos</code> son de la validación de cada snapshot, que cambia de mes a mes: no sirven para comparar modelos de meses distintos. Para eso es el examen congelado."))

G.append(dict(n=2, id="evaluar", titulo="Evaluar a los tres, foto por foto", objetivo="Las predicciones del candidato, del champion y del de hace 3 meses sobre el mismo examen, comprobando cada huella.",
    conceptos=["pares", "fuga", "labels-json"],
    explica="Antes de medir, se comprueba que lo que se mide es lo que se dice: el manifest del examen con la huella de <code>gate.yaml</code> y cada foto con la suya; los pesos de cada modelo con la huella de su corrida; su <code>labels.json</code> contra <code>entrada/categorias.json</code>; y que ninguna foto del examen esté en el snapshot con que se entrenó el candidato. Después, cada foto pasa por el preprocess del gateway y por los tres modelos, y se guarda por foto el top-5 y la confianza de cada uno: los <b>pares</b>.",
    codigo=[{"lang": "python", "path": "pipeline/evaluar.py", "code": code("pipeline/evaluar.py"), "nota": "Cada <code>sys.exit</code> es una razón para no evaluar: un examen que cambió, unos pesos que no son los anotados, unas categorías en otro orden o una fuga."}],
    comandos=[
        cmd("python pipeline/evaluar.py", L("p2 evaluar", quitar=r"^(real|user|sys) ")),
        cmd("python -c \"import pandas as pd; print(pd.read_parquet('reportes/cand-2026-10-01/pares.parquet').head(3))\"", L("p2 pares"), "Una fila por foto: su etiqueta, su slice y, por modelo, su top-5 y su confianza."),
        cmd(f"{V} examen pares labels", L("p2 verificar")),
    ],
    verifica=f"1,000 pares; top-1 en el examen: candidato {T_CAND} %, champion {T_CHAMP} %, hace 3 meses {T_H3} %; 20 predicciones del champion recalculadas iguales.",
    ojo="Sin <code>model.eval()</code>, la BatchNorm usa las estadísticas de cada lote y las predicciones cambian según con qué otras fotos venga cada una."))

G.append(dict(n=3, id="no-inferioridad", titulo="No inferioridad pareada, con reglas revisadas", objetivo="El candidato no es peor que v3 ni que v1 por más de 2.4 puntos, en top-1 y en top-5, y las reglas son las aprobadas.",
    conceptos=["no-inferioridad", "margen", "intervalo", "erosion"],
    explica="Primero, el gate comprueba sus propias reglas: <code>gate.yaml</code> en un commit y con una huella revisada. Después cuenta, contra cada modelo de <code>comparar_contra</code>, las fotos donde solo acierta el nuevo (b) y solo el otro (c): Δ = (b − c) ÷ N × 100, SE = √(b + c) ÷ N × 100 y Δmin = Δ − 1.96 × SE. Pasa si Δmin ≥ −2.4. Contra el de hace 3 meses es la misma regla: así se ataja la erosión.",
    codigo=[{"lang": "python", "path": G_, "code": trozo(G_, "# 1 · Las reglas", "# 4 · Por categoría"), "nota": "Las funciones <code>acierta()</code> y <code>pareada()</code> sirven también para categorías y slices."}],
    comandos=[
        cmd("sed -i '' 's/margen_puntos: 2.4 /margen_puntos: 3.0 /' gate.yaml\npython pipeline/gate.py", L("p3 sin commit"), "Una prueba: mover el margen sin commit."),
        cmd("git commit -qam \"gate: margen 3.0 (prueba)\"\npython pipeline/gate.py", L("p3 sin revision"), "En un commit, pero sin revisión: tampoco."),
        cmd("git revert --no-edit HEAD\npython pipeline/gate.py", L("p3 gate"), "Con las reglas revisadas de vuelta."),
        cmd(f"{V} no-inferioridad umbrales", L("p3 verificar")),
    ],
    verifica=f"Contra v3: b = {B}, c = {C}, Δmin = {DMIN} ≥ −2.4. Contra v1 pasa con holgura. Y el gate se negó a correr con un <code>gate.yaml</code> sin commit o sin revisión.",
    ojo=f"El candidato acierta {float(T_CAND) - float(T_CHAMP):.1f} puntos más que el champion y aun así su Δmin es {DMIN}: con {DISC} discrepancias, el examen no puede asegurar que sea mejor, solo que no es peor. Para un reentrenamiento mensual, eso basta."))

G.append(dict(n=4, id="categorias", titulo="Categorías, slices y calibración", objetivo="Ninguna categoría rota, ningún slice abajo de su margen y la confianza del candidato calibrada.",
    conceptos=["mcnemar", "holm", "slice", "calibracion"],
    explica="Un promedio que no baja puede esconder una categoría rota. Por categoría, el gate pide dos cosas para declararla rota: que el recall caiga más de 5 puntos <b>y</b> que la caída sea significativa (McNemar con las discrepancias de esa categoría, corregido con Holm porque son 10 pruebas). Por slice, la misma no inferioridad pareada con un margen de 5 puntos (con ≈ 200 fotos, el ruido es de ese tamaño). Y la calibración: el ECE del candidato, con 15 cubetas de confianza, ≤ 0.05. Todo va al reporte y a una corrida de MLflow; si algo falla, la corrida queda FAILED y el proceso sale con código 1.",
    codigo=[{"lang": "python", "path": G_, "code": trozo(G_, "# 4 · Por categoría"), "nota": "El último bloque decide: el veredicto va al reporte, a MLflow y al código de salida. <code>sys.exit</code> con un mensaje sale con código 1."}],
    comandos=[
        cmd("python pipeline/gate.py      # la misma corrida del paso 3", L("p3 gate", filtro=r"^\[(categorías|slice|calibración)\]|^✓")),
        cmd("python -c \"\nimport json\nr = json.load(open('reportes/cand-2026-10-01/reporte.json'))\nfor x in r['categorias']:\n    print(x['categoria'], x['n'], x['recall_champion'], '→', x['recall_candidato'], x['b'], x['c'], x['p'], x['p_holm'])\"", L("p4 reporte"), "Las 10 categorías del reporte (la salida es la del script de prueba, con columnas alineadas)."),
        cmd(f"{V} categorias slices", L("p4 verificar")),
    ],
    verifica="10 categorías con McNemar y Holm, ninguna rota; los tres slices dentro de su margen; ECE ≤ 0.05.",
    ojo="Camisas sube 13 puntos y su p es chica: McNemar también detecta mejoras. La regla solo frena caídas."))

G.append(dict(n=5, id="frena", titulo="El gate que frena", objetivo="El candidato del proveedor no pasa, la corrida queda en rojo y el motivo dice por qué.",
    conceptos=["falla-ruidosa"],
    explica="El segundo candidato de octubre se entrenó con un lote del proveedor que etiquetó como «playeras» casi la mitad de las camisas. Se evalúa con el mismo champion y el mismo examen. El gate no «devuelve false»: termina con código 1 y su corrida en MLflow queda FAILED, con el motivo. Así el orquestador no sigue a los pasos de después y la alerta de pipeline fallido avisa a alguien.",
    codigo=[],
    comandos=[
        cmd("python pipeline/evaluar.py --candidato cand-2026-10-01-proveedor", L("p5 evaluar")),
        cmd("python pipeline/gate.py --candidato cand-2026-10-01-proveedor", L("p5 gate")),
        cmd("python mundo/modelos.py gates", L("p5 gates"), "Abre la corrida roja en MLflow (experimento <code>c01-gate</code>): el reporte está en sus artefactos."),
        cmd(f"{V} frena", L("p5 verificar")),
    ],
    verifica=f"El gate del proveedor quedó FAILED y su motivo nombra camisas (p de Holm {P_CAM}), además del top-1 global y el slice de poca luz.",
    ojo="Un gate que atrapa la excepción «para que el pipeline no truene» deja la corrida en verde, salta los pasos siguientes y nadie se entera de que no hubo challenger."))

G.append(dict(n=6, id="registrar", titulo="Registrar el challenger", objetivo="El candidato que pasó, como una versión nueva de classifier con sus tags y el alias challenger; champion no se toca.",
    conceptos=["registry", "champion", "labels-json"],
    explica="Registrar no es «subir el modelo»: es dejar escrito qué es y por qué pasó. <code>registrar.py</code> busca la última corrida de gate del candidato y se niega si no terminó en verde, si sus reglas no estaban revisadas, si el examen no es el de <code>gate.yaml</code> o si champion ya no es la versión contra la que se comparó (un veredicto viejo). Después crea la versión apuntando a los archivos de la corrida, con sus tags (gate, snapshot, huellas de pesos y de <code>labels.json</code>, examen, champion y Δmin) y le pone <code>challenger</code>. Correrlo dos veces no crea dos versiones.",
    codigo=[{"lang": "python", "path": "pipeline/registrar.py", "code": code("pipeline/registrar.py"), "nota": ""}],
    comandos=[
        cmd("python pipeline/registrar.py --candidato cand-2026-10-01-proveedor", L("p6 proveedor")),
        cmd("python pipeline/registrar.py", L("p6 registrar")),
        cmd("python pipeline/registrar.py", L("p6 otra vez"), "Otra vez: no duplica."),
        cmd("python mundo/modelos.py versiones", L("p6 versiones")),
        cmd(f"{V} registro", L("p6 verificar")),
        cmd(V, L("final", filtro=r"en verde")),
    ],
    verifica="<code>classifier</code> v4 <code>@challenger</code> con <code>gate=passed</code> y sus tags; <code>@champion</code> sigue en v3; los 10 checks en verde.",
    ojo="Volver atrás (rollback) es mover el alias champion a la versión anterior: un comando, segundos. Por eso la versión vieja no se borra."))

REPARTO = {
    1: (["gate", "champion", "version-numero", "golden", "reglas-antes"], ["margen"]),
    2: (["pares", "fuga", "labels-json"], ["tabla"]),
    3: (["no-inferioridad", "margen", "intervalo", "erosion"], ["pareado", "erosion"]),
    4: (["mcnemar", "holm", "slice", "calibracion"], ["categoria", "holm"]),
    5: (["falla-ruidosa"], []),
    6: (["registry"], []),
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
        "Las reglas no se tocan: <code>gate.yaml</code> y <code>corrida.yaml</code> se quedan como vienen.",
    ],
    "objetivos": [
        {"n": 1, "objetivo": "El S3 local y MLflow arriba, el mundo creado y la carpeta en git.", "check": "mundo"},
        {"n": 2, "objetivo": "Tu evaluación usa el examen congelado (manifest y fotos con su huella) y comprueba que no haya fuga.", "check": "examen", "pista": "¿Dónde dice cuál es la huella correcta del examen?"},
        {"n": 3, "objetivo": "Los pares de los tres modelos, por número de versión, en el orden del manifest, con las predicciones de verdad.", "check": "pares"},
        {"n": 4, "objetivo": "Todos los labels.json (versiones y candidato) son entrada/categorias.json.", "check": "labels"},
        {"n": 5, "objetivo": "No inferioridad pareada en top-1 y top-5 contra champion y hace 3 meses: b, c y Δmin correctos.", "check": "no-inferioridad", "pista": "¿Qué fotos cuentan para la diferencia?"},
        {"n": 6, "objetivo": "Por categoría: caída, McNemar exacto, Holm y «rota» correctos.", "check": "categorias"},
        {"n": 7, "objetivo": "Δmin por slice y ECE del candidato.", "check": "slices"},
        {"n": 8, "objetivo": "El gate del candidato del proveedor queda FAILED, con camisas en el motivo, y no se registra.", "check": "frena", "pista": "¿Qué código de salida ve el orquestador?"},
        {"n": 9, "objetivo": "Todos tus gates con un gate.yaml revisado, y sin cambios pendientes.", "check": "umbrales"},
        {"n": 10, "objetivo": "El candidato bueno registrado como challenger, con sus tags; champion sigue en v3.", "check": "registro"},
    ],
}

FAL = []


def falla(id_, titulo, tipo, historia, sintoma, hipotesis, confirma_code, confirma_salida, arreglo, concepto, check, nota=""):
    FAL.append(dict(id=id_, titulo=titulo, tipo=tipo, historia=historia, sintoma=sintoma, hipotesis=hipotesis,
                    confirma=cmd(confirma_code, confirma_salida, nota), arreglo=arreglo, concepto=concepto, check=check))


if LOGF:
    falla("umbral-movido", "Reglas más flexibles, «solo por esta vez»", "config",
          "El equipo de búsqueda necesita que el modelo del proveedor salga esta semana. Alguien de ese equipo subió un commit a gate.yaml directo a main y avisó en el canal: «ya lo destrabé».",
          "<code>verificar.py</code>: " + F("f1 detecta", filtro=r"^✗"),
          ["Alguien cambió las reglas.", "Cambió el examen.", "Cambió tu gate.py."],
          "git log -1 --format=\"%h %an · %s\" -- gate.yaml\ngit show HEAD -- gate.yaml | grep \"^[-+] \"\npython pipeline/gate.py --candidato cand-2026-10-01-proveedor", F("f1 confirma") + "\n" + F("f1 gate"),
          "Un commit sin revisión dejó <code>margen_puntos: 4.0</code> y <code>caida_max_puntos: 25</code>: con eso, el candidato del proveedor (camisas −21 puntos) pasaría. Tu gate se niega a juzgar con reglas cuya huella no está en <code>mundo/revisiones.json</code>. Arreglo: <code>git revert --no-edit HEAD</code>. Si de verdad hay que cambiar una regla, va en un PR propio, revisado, antes de la corrida siguiente, y nunca para que pase un modelo en particular.",
          "reglas-antes", "umbrales")
    falla("golden-tocado", "Alguien «corrigió» el examen", "mundo",
          "El equipo de búsqueda revisó a mano el golden set y escribió en el canal: «había 30 etiquetas mal, ya las arreglé». El modelo nuevo ahora sale mejor.",
          "<code>verificar.py</code>: " + F("f2 detecta", filtro=r"^✗", max_lineas=1),
          ["Cambió el manifest del examen.", "Cambió gate.yaml.", "Cambiaron las fotos."],
          "python mundo/s3.py golden\npython mundo/s3.py versiones golden/golden-v1/manifest.json\npython pipeline/evaluar.py", F("f2 confirma") + "\n" + F("f2 evaluar"),
          "El manifest de <code>golden-v1</code> tiene 30 etiquetas cambiadas y su huella ya no es la de <code>gate.yaml</code>: un examen que cambia deja de comparar con los meses anteriores. El bucket tiene versionado: <code>python mundo/s3.py restaurar golden/golden-v1/manifest.json &lt;version-id de la primera&gt;</code> devuelve el examen congelado. Si de verdad había etiquetas malas, se publica <code>golden-v2</code> en un PR propio y todos los modelos se vuelven a medir con él.",
          "golden", "examen")
    falla("golden-fuga", "El candidato que sube 3 puntos", "mundo",
          "El equipo de búsqueda reentrenó el candidato «con más datos» y cambió corrida.yaml para usarlo: «sube 3 puntos en el golden, ¡va!».",
          "<code>verificar.py</code>: " + F("f3 detecta", filtro=r"^✗ examen"),
          ["El candidato se entrenó con fotos del examen.", "Cambió el examen.", "Cambió el champion."],
          "git log -1 --format=\"%h %an · %s\" -- corrida.yaml\npython mundo/modelos.py candidatos | tail -1\npython mundo/s3.py tarjeta ds-2026-09-15\npython pipeline/evaluar.py", F("f3 confirma") + "\n" + F("f3 evaluar"),
          "El candidato nuevo se entrenó con <code>ds-2026-09-15</code>, un snapshot armado a mano que trae las 1,000 fotos del examen: ya vio las respuestas. Tu <code>evaluar.py</code> cruza las huellas y se detiene. Arreglo: <code>git revert --no-edit HEAD</code> (vuelve el candidato del pipeline) y pedir que el snapshot se reconstruya con el pipeline de la estación 2, que deja fuera el golden set por diseño.",
          "fuga", "examen")
    falla("alias-a-mano", "Ya está en producción", "mundo",
          "Esta mañana el equipo de búsqueda escribió: «subimos el modelo del proveedor a producción, ya lo probamos en el notebook». La aceptación de sugerencias de camisas se cayó.",
          "<code>verificar.py</code>: " + F("f4 detecta", filtro=r"^✗"),
          ["Alguien movió champion.", "Se registró una versión que nadie aprobó.", "El gate dejó pasar al proveedor."],
          "python mundo/modelos.py versiones", F("f4 confirma"),
          "Alguien registró a mano el candidato del proveedor (sin <code>gate=passed</code>) y le movió <code>@champion</code>: eso ya es producción. El registro no impide mover un alias; la regla de que solo CD lo mueve, después del gate y del canary, es del equipo. Arreglo: <code>python mundo/modelos.py alias champion 3</code>. El rollback es mover el alias, no reentrenar. La versión mal subida se queda sin alias y sin <code>gate=passed</code>.",
          "champion", "registro")
    falla("labels-desordenados", "La herramienta nueva de export", "mundo",
          "El equipo de plataforma estrenó un script que «limpia» los artefactos de las corridas. Lo corrieron sobre el candidato de octubre anoche.",
          "<code>verificar.py</code>: " + F("f5 detecta", filtro=r"^✗"),
          ["Cambió el labels.json del candidato.", "Cambiaron sus pesos.", "Cambió entrada/categorias.json."],
          f"{V} labels\npython pipeline/evaluar.py", F("f5 confirma", filtro=r"^✗|en verde") + "\n" + F("f5 evaluar"),
          "El <code>modelo/labels.json</code> de la corrida <code>cand-2026-10-01</code> se sobrescribió en orden alfabético: los archivos de una corrida de MLflow se pueden reemplazar. Los pesos son los mismos, así que la evaluación por índice saldría igual, pero registrado así el gateway mostraría otra categoría. Por eso la versión guarda <code>labels_sha256</code>. Arreglo: <code>python mundo/modelos.py labels cand-2026-10-01</code> y otra vez <code>evaluar.py</code>.",
          "labels-json", "labels")
    falla("mlflow-caido", "El gate no corrió", "infra",
          "El pipeline de anoche quedó en rojo en el paso del gate y nadie sabe si el candidato es bueno o malo.",
          "<code>verificar.py</code>: casi todo falla. " + F("f6 detecta", filtro=r"^✗ mundo"),
          ["Se cayó MLflow.", "Se cayó el S3.", "Se borró el candidato."],
          "docker compose ps -a --format \"{{.Service}}: {{.State}} · {{.Status}}\"\npython pipeline/evaluar.py", F("f6 confirma") + "\n" + F("f6 gate"),
          "El contenedor de MLflow está detenido. Sin el registro no hay champion por número ni candidato, y el gate no puede anotar su veredicto: falla en segundos, y está bien que falle. Un gate que «pasa» porque no pudo medir es peor que uno en rojo. Arreglo: <code>docker compose up -d --wait mlflow</code>.",
          "falla-ruidosa", "mundo")
e["fallas"] = FAL

e["listo"] = [
    "El candidato es no inferior al champion y al de hace 3 meses (Δmin ≥ −margen, en top-1 y top-5), sobre el examen congelado y sin fuga.",
    "Ninguna categoría cae más de 5 puntos con una caída significativa (McNemar + Holm), ningún slice cae más que su margen y el ECE está en su límite.",
    "Las reglas eran las revisadas, y el champion entró por número.",
    "Un candidato que rompe una categoría deja la corrida en rojo, con el motivo, y no se registra.",
    "El candidato que pasó es una versión con <code>gate=passed</code>, sus huellas y el alias <code>challenger</code>; champion no se movió.",
    "Sabes qué versión es champion y a cuál vuelves si algo falla.",
]

e["repaso"] = {
    "memo": "<b>El gate decide si vale la pena probar; el canary, si se queda.</b> Reglas escritas antes (y cambiadas solo en un PR), el champion por número, el mismo examen congelado y los pares foto por foto. No inferioridad contra el champion y contra el de hace 3 meses, cada categoría y cada slice aparte, y si algo falla, en rojo. Promover y volver atrás es mover un alias.",
    "trampa": "Mover los umbrales después de ver el resultado («el slice cayó 6, subo el límite a 7»). El gate deja de medir y empieza a justificar.",
    "entrevista": [
        {"q": "¿Cómo decides si el modelo reentrenado puede reemplazar al de producción?", "a": "Con un gate automático y reglas escritas antes: los dos modelos sobre el mismo golden set congelado, foto por foto. No inferioridad pareada (el extremo de abajo del intervalo de la diferencia ≥ −margen, con el margen del tamaño del ruido del examen), también contra el modelo de hace 3 meses por la erosión. Además, recall por categoría con McNemar y Holm, slices y calibración. Si pasa, se registra como challenger; el champion se mueve después del canary."},
        {"q": "¿Por qué no inferioridad y no «que sea mejor»?", "a": "Porque el reentrenamiento mensual busca estar al día, no ganar. Exigir una mejora significativa bloquearía casi todos los meses, y «≥ champion» decide con el ruido: dos modelos iguales salen uno arriba del otro la mitad de las veces. La no inferioridad acepta perder menos de lo que el examen puede medir."},
        {"q": "El top-1 global subió, pero una categoría grande se rompió. ¿Cómo lo atrapas?", "a": "Recall por categoría contra el champion con los pares de esa categoría: McNemar exacto con sus discrepancias, corregido con Holm porque son muchas pruebas, y además un tamaño mínimo de caída para que importe. Más slices: luz, tamaño, dispositivo."},
        {"q": "¿Qué guarda la versión del registry?", "a": "Apunta a los artefactos (pesos, labels.json) y lleva tags: gate=passed y la corrida del gate, snapshot, commit, huellas de pesos y de labels.json, examen, contra qué champion se comparó y sus métricas. El alias challenger. Y nunca cambia: lo que se mueve son los alias."},
        {"q": "Alguien quiere aflojar un umbral porque el modelo de esta semana no pasa. ¿Qué haces?", "a": "No lo muevo para este modelo. Si hay un argumento, va en un PR propio, revisado, que aplica desde la corrida siguiente, con la justificación (por ejemplo, el examen creció y el ruido bajó). Un override para una corrida concreta pide dos personas y deja un tag."},
        {"q": "¿Cómo sabes que el examen no está contaminado?", "a": "El golden set se congela con un manifest y su huella, se excluye de todos los snapshots por diseño, y el gate cruza las huellas de las fotos del examen con las del snapshot del candidato antes de evaluar: una sola coincidencia detiene todo."},
    ],
}

e["prompts"] = {
    "claude_md": "kits/c01-gate/CLAUDE.md",
    "guiado": "content/estaciones/c01-gate/prompts/guiado.md",
    "solo": "content/estaciones/c01-gate/prompts/solo.md",
    "romper_ayuda": "content/estaciones/c01-gate/prompts/romper-ayuda.md",
    "romper_solo": "content/estaciones/c01-gate/prompts/romper-solo.md",
}

(APP / "content/estaciones/c01-gate.json").write_text(json.dumps(e, ensure_ascii=False, indent=2) + "\n")
print("ok", len(json.dumps(e, ensure_ascii=False)), "· fallas:", len(FAL))
