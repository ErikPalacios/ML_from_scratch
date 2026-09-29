/* =============================================================================
   Ronda de Diseño ML — js/content/m12-monitoreo.js
   Módulo 12: monitoreo. Falla silenciosa y las cinco capas, métricas de sistema
   (golden signals, RED/USE, GPU, colas y DLQ), métricas de modelo con y sin labels,
   tipos de drift, detección (PSI, KS, chi-cuadrado, embeddings), Prometheus +
   Grafana + Alertmanager con SLOs y burn rate, logging de predicciones, cuándo
   reentrenar y runbooks.
   Contrato: docs/SPEC.md §5. Ejemplos: c01 (servicio online) y c04 (batch con
   humano en el loop, SPEC §8d). Nombres de métricas, umbrales y alertas de c01, c02
   y c03 son los de sus archivos: si cambian allá, se cambian aquí.
   Verificado (sept. 2026) contra documentación oficial: Google SRE Workbook
   (tabla de burn rates 14.4/6/1 con ventanas 1 h/5 min, 6 h/30 min, 3 d/6 h),
   Prometheus (reglas de alerta y de grabación, Pushgateway solo para batch a nivel
   de servicio; native histograms estables desde v3.8, con scrape_native_histograms
   explícito desde v3.9), prometheus_client de Python (Summary sin cuantiles),
   Amazon SQS (ApproximateAgeOfOldestMessage excluye mensajes recibidos 3+ veces en
   colas estándar; en la DLQ estándar se conserva el timestamp de encolado original),
   KEDA aws-sqs-queue (escala por visibles + en vuelo, queueLength 5 por defecto),
   DCGM (GPU_UTIL vs SM_ACTIVE vs SM_OCCUPANCY), Evidently 0.7.x (métodos de drift por
   defecto según tamaño de muestra; domain classifier para embeddings, ROC AUC 0.55),
   NannyML (Apache 2.0, tabular, CBPE/DLE), whylogs (WhyLabs adquirida por Apple en
   2025, plataforma discontinuada), Alibi Detect (BSL 1.1 desde el 22-ene-2024) y
   Rabanser et al., "Failing Loudly" (NeurIPS 2019).
   PSI, KS, burn rates, intervalos, costos de logs y cardinalidad se recalcularon con
   Python (numpy/scipy); los snippets de Python corrieron tal cual; el YAML se parseó
   con PyYAML y cada expresión PromQL con un parser de PromQL (promql-parser).
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // Marca de estimación (SPEC §5.3): subrayado punteado + "est."
  const E = (s) => '<span class="est">' + s + '</span>';

  // ------------------------------------------------------------ diagrama
  // Tres carriles: online arriba (servicio y humano que revisa), monitoreo al centro
  // (Grafana ← Prometheus → Alertmanager) y offline abajo (logs → job → reentreno,
  // con labels demorados). Columnas x = 4, 30, 56 y 84; huecos de 8–10 unidades para
  // las etiquetas. El log baja por x = 1.5 (a la izquierda de Grafana y de los logs)
  // para no cruzar nodos; humano → labels baja por x = 94, libre en el carril de
  // monitoreo; labels → job vuelve por debajo de la fila (y = 48).
  const STACK = {
    width: 108, height: 51,
    lanes: [
      { id: 'online', label: 'Online · cada request o slide', x: 0, y: 0, w: 108, h: 14, kind: 'online' },
      { id: 'monitor', label: 'Monitoreo · métricas y alertas', x: 0, y: 16, w: 108, h: 14, kind: 'monitor' },
      { id: 'offline', label: 'Offline · logs, labels y reentrenamiento', x: 0, y: 32, w: 108, h: 19, kind: 'offline' },
    ],
    nodes: [
      { id: 'svc', label: 'Servicio / worker', sub: 'gateway · seg-worker', x: 30, y: 4, w: 18, h: 7, kind: 'service',
        note: 'Lo que monitoreas. Expone <code>/metrics</code> (contadores e histogramas en memoria, baratos) y escribe una línea de log por predicción. En c01 es el gateway FastAPI; en c04, el <code>seg-worker</code> que procesa slides de la cola. Nunca bloquea una respuesta por culpa del monitoreo.' },
      { id: 'human', label: 'Revisión humana', sub: 'vendedor · patólogo', x: 84, y: 4, w: 20, h: 7, kind: 'human',
        note: 'Quien ve el resultado y reacciona: el vendedor acepta o cambia la categoría (c01), el patólogo acepta o corrige el contorno antes de firmar (c04). Esa reacción es el label demorado más valioso y también el más sesgado, porque la persona vio la propuesta del modelo.' },
      { id: 'graf', label: 'Grafana', sub: 'por audiencia', x: 4, y: 19.5, w: 18, h: 7, kind: 'monitor',
        note: 'Consulta a Prometheus con PromQL y pinta dashboards: uno para el on-call (síntomas), otro para el equipo de ML (drift y calidad por slice y por model_version), otro para negocio. No guarda métricas: las lee.' },
      { id: 'prom', label: 'Prometheus', sub: 'series + reglas', x: 30, y: 19.5, w: 18, h: 7, kind: 'monitor',
        note: 'Hace scrape (pull) de cada target cada 15–30 s, guarda series de tiempo y evalúa reglas de grabación y de alerta. Es la memoria corta del sistema (días a semanas); para meses se usa almacenamiento remoto o los agregados del data lake.' },
      { id: 'am', label: 'Alertmanager', sub: 'page · ticket', x: 56, y: 19.5, w: 18, h: 7, kind: 'monitor',
        note: 'Recibe las alertas que disparan las reglas y decide a quién van: agrupa (una notificación por incidente, no cien), deduplica, inhibe (si la planta no tiene enlace, no mandes cinco pages por equipo) y enruta por severidad: page al on-call, ticket al equipo de ML en horario.' },
      { id: 'logs', label: 'Logs de predicción', sub: 'S3 · Parquet', x: 4, y: 36, w: 18, h: 7, kind: 'store',
        note: 'Una fila por predicción: request_id o slide_id, model_version, referencias al input (hash, no la imagen), salida, confianza y latencia. Base del drift, del join con labels y de la selección para etiquetado. Particionado por día y modelo para que los jobs lean solo lo que necesitan.' },
      { id: 'job', label: 'Job de monitoreo', sub: 'drift + labels', x: 30, y: 36, w: 18, h: 7, kind: 'job',
        note: 'Batch (cada hora o cada día): compara distribuciones de hoy contra la referencia (PSI, KS, embeddings), une predicciones con los labels que ya llegaron y calcula métricas por slice. Publica los resultados como métricas para que Prometheus alerte con el mismo mecanismo que todo lo demás.' },
      { id: 'retrain', label: 'Reentrenamiento', sub: 'gate → canary', x: 56, y: 36, w: 18, h: 7, kind: 'job',
        note: 'El pipeline de <a href="#m10.reentrenamiento">M10</a>. Un disparador del monitoreo abre un ticket y adelanta la corrida; el candidato pasa por el mismo gate, shadow y canary que cualquier otro (<a href="#m11">M11</a>). El monitoreo nunca despliega un modelo solo.' },
      { id: 'labels', label: 'Labels demorados', sub: 'edits · auditoría', x: 84, y: 36, w: 20, h: 7, kind: 'store',
        note: 'Lo que llega tarde: aceptación de la sugerencia (minutos a horas), re-categorización de moderadores (días), correcciones del patólogo al firmar (horas a días) y la auditoría mensual independiente de c04 (un mes). Se guardan como eventos con el mismo id de la predicción para poder unirlos.' },
    ],
    edges: [
      { from: 'svc', to: 'human', kind: 'online', label: 'resultado' },
      { from: 'svc', to: 'prom', kind: 'monitor', fromSide: 'b', toSide: 't', label: 'pull /metrics' },
      { from: 'prom', to: 'graf', kind: 'monitor', fromSide: 'l', toSide: 'r', label: 'PromQL' },
      { from: 'prom', to: 'am', kind: 'monitor', label: 'alertas' },
      { from: 'svc', to: 'logs', kind: 'async', fromSide: 'l', toSide: 'l', via: [[1.5, 7.5], [1.5, 39.5]], label: 'log' },
      { from: 'logs', to: 'job', kind: 'offline', label: 'lote' },
      { from: 'job', to: 'prom', kind: 'monitor', fromSide: 't', toSide: 'b', label: 'métricas' },
      { from: 'human', to: 'labels', kind: 'offline', fromSide: 'b', toSide: 't', label: 'correcciones' },
      { from: 'labels', to: 'job', kind: 'offline', fromSide: 'b', toSide: 'b', via: [[94, 48], [39, 48]], label: 'join por id' },
      { from: 'labels', to: 'retrain', kind: 'offline', fromSide: 'l', toSide: 'r', label: 'datos' },
      { from: 'job', to: 'retrain', kind: 'offline', label: 'ticket' },
    ],
    flows: [
      { id: 'ruidosa', label: 'Falla ruidosa: sube el p99 (c01)', steps: [
        { nodes: ['svc', 'prom'], edges: ['svc>prom'], text: 'El gateway observa cada latencia en un histograma. Prometheus hace scrape cada 15 s; nadie calcula promedios en el servicio.' },
        { nodes: ['prom'], edges: [], text: 'La regla <code>ClassifierHighP99Latency</code> calcula el p99 con <code>histogram_quantile</code> sobre los buckets sumados de todos los pods: 240 ms, sostenido 10 min.' },
        { nodes: ['prom', 'am'], edges: ['prom>am'], text: 'La alerta dispara con <code>severity: page</code>. Alertmanager la agrupa con las otras del mismo servicio y despierta al on-call con el link al runbook.' },
        { nodes: ['prom', 'graf'], edges: ['prom>graf'], text: 'El on-call abre el dashboard de servicio: el tramo que subió es la cola de Triton, no el preprocesamiento. KEDA ya está en su máximo: falta capacidad de GPU.' },
      ] },
      { id: 'silenciosa', label: 'Falla silenciosa: tinción nueva (c04)', steps: [
        { nodes: ['svc', 'logs'], edges: ['svc>logs'], text: 'El worker procesa slides del lab C sin un solo error. Por cada slide deja en los logs sus estadísticas de color de tejido, la fracción de tiles borrosos y el % de tumor predicho.' },
        { nodes: ['logs', 'job'], edges: ['logs>job'], text: 'El job diario compara el histograma de color del escáner Y contra la referencia de entrenamiento del modelo actual (labs A, B y C, desde que C entró al entrenamiento): PSI ≈ 0.22.' },
        { nodes: ['job', 'prom', 'am'], edges: ['job>prom', 'prom>am'], text: 'Publica el PSI como métrica por lab y escáner. La regla <code>StainDriftPerScanner</code> (PSI &gt; 0.2) dispara como ticket: nadie se despierta, el equipo de ML lo ve en horario.' },
        { nodes: ['job', 'retrain'], edges: ['job>retrain'], text: 'El runbook pide confirmar impacto con labels antes de reentrenar. Si se confirma, el ticket adelanta el reentrenamiento con labels del lab C; nada se despliega sin gate y modo silencioso.' },
      ] },
      { id: 'label', label: 'Label demorado: tasa de correcciones', steps: [
        { nodes: ['svc', 'human'], edges: ['svc>human'], text: 'El patólogo abre el caso con el contorno propuesto y lo corrige antes de firmar. El sistema guarda la corrección como una anotación nueva, sin pisar la salida del modelo.' },
        { nodes: ['human', 'labels'], edges: ['human>labels'], text: 'La corrección llega como evento: slide_id, model_version, área cambiada. Si cambió más de 20 % del área, es un major edit.' },
        { nodes: ['labels', 'job'], edges: ['labels>job'], text: 'El job une correcciones con predicciones por slide_id y calcula la tasa de major edits por lab, escáner y tipo de espécimen en ventanas de 4 semanas contra su línea base.' },
        { nodes: ['labels', 'retrain'], edges: ['labels>retrain'], text: 'Las correcciones, junto con los labels de active learning y la auditoría independiente, alimentan el reentrenamiento mensual.' },
      ] },
    ],
  };

  // ------------------------------------------------------------ código
  // Corrió con Python 3.14, numpy y scipy: imprime 0.215, 0.002 y 0.245.
  const PSI_PY = `import numpy as np

def psi(referencia, actual, bins=10, eps=1e-4):
    """PSI entre dos muestras de una variable continua (p. ej. matiz medio por tile)."""
    # Bordes por cuantiles de la REFERENCIA: cada bin tiene ≈ 10 % de ella, ninguno vacío
    bordes = np.quantile(referencia, np.linspace(0, 1, bins + 1))
    bordes[0], bordes[-1] = -np.inf, np.inf          # lo que caiga fuera del rango también cuenta
    ref = np.histogram(referencia, bordes)[0] / len(referencia)
    act = np.histogram(actual, bordes)[0] / len(actual)
    ref, act = np.clip(ref, eps, None), np.clip(act, eps, None)   # un bin vacío haría ln(0)
    return float(np.sum((act - ref) * np.log(act / ref)))

def psi_de_proporciones(ref, act):
    ref, act = np.asarray(ref), np.asarray(act)
    return float(np.sum((act - ref) * np.log(act / ref)))

# El ejemplo de la tabla: 5 bins de matiz, escáner Y contra la referencia de entrenamiento (A, B y C)
print(round(psi_de_proporciones([.10, .20, .40, .20, .10], [.04, .12, .34, .30, .20]), 3))  # 0.215

rng = np.random.default_rng(0)
ref = rng.normal(0.0, 1.0, 50_000)
print(round(psi(ref, rng.normal(0.0, 1.0, 5_000)), 3))    # misma distribución: ≈ 0 (solo ruido)
print(round(psi(ref, rng.normal(0.5, 1.0, 5_000)), 3))    # corrida de media 0.5 σ: ≈ 0.25`;

  // Corrió con scipy 1.16: imprime D=0.0082 p=8.3e-30 y D=0.1460 p=1.0e-09.
  const KS_PY = `import numpy as np
from scipy.stats import ks_2samp

rng = np.random.default_rng(0)
# Un día de c04: ≈ 1 M tiles por lado, corrida minúscula de 0.02 σ
a, b = rng.normal(0, 1, 1_000_000), rng.normal(0.02, 1, 1_000_000)
r = ks_2samp(a, b)
print(f"n=1M   D={r.statistic:.4f}  p={r.pvalue:.1e}")   # D ≈ 0.008, p ≈ 1e-29: "significativo"
# 1,000 tiles con una corrida real de 0.3 σ
a, b = rng.normal(0, 1, 1_000), rng.normal(0.3, 1, 1_000)
r = ks_2samp(a, b)
print(f"n=1k   D={r.statistic:.4f}  p={r.pvalue:.1e}")   # D ≈ 0.15, p ≈ 1e-9: esto sí importa`;

  // Corrió con prometheus_client; el scrape de :9100/metrics mostró las series de abajo.
  const METRICAS_PY = `import random, time
from prometheus_client import Counter, Histogram, start_http_server

# Mismos nombres de métrica que el gateway de c01 (son contrato con las alertas). Versión
# reducida: allá, además, el label source y 11 buckets desde 0.01 s
REQUESTS = Counter("classifier_requests_total", "Requests por código y modelo",
                   ["status", "model_version"])          # el cliente no duplica el sufijo _total
LATENCY = Histogram("classifier_request_latency_seconds", "Latencia server-side",
                    buckets=(0.025, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1.0))  # finos cerca del SLO (0.2 s)
TOP1 = Histogram("classifier_top1_score", "Score top-1 tras softmax", ["model_version"],
                 buckets=(0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0))
MODEL_VERSION = "2026-09-01-resnet50-fp16"

def atender():
    t0 = time.perf_counter()
    status = "200"
    try:
        score = random.betavariate(5, 2)             # aquí iría la llamada real al modelo
        TOP1.labels(model_version=MODEL_VERSION).observe(score)
    except Exception:
        status = "500"
        raise
    finally:
        REQUESTS.labels(status=status, model_version=MODEL_VERSION).inc()
        LATENCY.observe(time.perf_counter() - t0)    # nunca un promedio: buckets

if __name__ == "__main__":
    start_http_server(9100)                          # Prometheus hace scrape de :9100/metrics
    while True:
        atender()
        time.sleep(0.01)`;

  const METRICAS_OUT = `# TYPE classifier_requests_total counter
classifier_requests_total{model_version="2026-09-01-resnet50-fp16",status="200"} 233.0
# TYPE classifier_request_latency_seconds histogram
classifier_request_latency_seconds_bucket{le="0.2"} 233.0
classifier_request_latency_seconds_bucket{le="+Inf"} 233.0
classifier_request_latency_seconds_count 233.0
classifier_request_latency_seconds_sum 0.0075
# Cada bucket es una serie: 8 bordes + "+Inf" + _sum + _count = 11 series (más _created,
# que el cliente agrega por defecto y se apaga con PROMETHEUS_DISABLE_CREATED_SERIES=True)`;

  // YAML parseado con PyYAML; cada expr validada con un parser de PromQL.
  const SLO_YML = `# Parte de errores del SLO de c01: 99.9 % a 30 días (su SLI también exige ≤ 300 ms) → presupuesto 0.1 %
groups:
  - name: classifier-slo-recording
    rules:
      # Una regla por ventana: la alerta compara ventanas ya calculadas (barato y legible)
      - record: classifier:error_ratio:rate5m
        expr: |
          sum(rate(classifier_requests_total{status=~"5.."}[5m]))
            / sum(rate(classifier_requests_total{status!~"4.."}[5m]))
      - record: classifier:error_ratio:rate30m
        expr: |
          sum(rate(classifier_requests_total{status=~"5.."}[30m]))
            / sum(rate(classifier_requests_total{status!~"4.."}[30m]))
      - record: classifier:error_ratio:rate1h
        expr: |
          sum(rate(classifier_requests_total{status=~"5.."}[1h]))
            / sum(rate(classifier_requests_total{status!~"4.."}[1h]))
      - record: classifier:error_ratio:rate6h
        expr: |
          sum(rate(classifier_requests_total{status=~"5.."}[6h]))
            / sum(rate(classifier_requests_total{status!~"4.."}[6h]))
  - name: classifier-slo-alerts
    rules:
      # 14.4× durante 1 h = 2 % del presupuesto mensual; la ventana de 5 min hace que se apague rápido
      - alert: ClassifierErrorBudgetFastBurn
        expr: |
          classifier:error_ratio:rate1h > (14.4 * 0.001)
          and classifier:error_ratio:rate5m > (14.4 * 0.001)
        labels:
          severity: page
        annotations:
          summary: "Quemando el presupuesto de errores 14.4× más rápido de lo permitido"
          description: "Error ratio 1 h = {{ $value | humanizePercentage }} (umbral 1.44 %)."
          runbook_url: "https://runbooks.example.com/classifier/error-budget-burn"
      # 6× durante 6 h = 5 % del presupuesto; el SRE Workbook lo manda a page, c01 a ticket (hay fallback)
      - alert: ClassifierErrorBudgetSlowBurn
        expr: |
          classifier:error_ratio:rate6h > (6 * 0.001)
          and classifier:error_ratio:rate30m > (6 * 0.001)
        labels:
          severity: ticket
        annotations:
          summary: "Quemando el presupuesto de errores 6× más rápido de lo permitido"
          runbook_url: "https://runbooks.example.com/classifier/error-budget-burn"`;

  // ------------------------------------------------------------ registro
  MSD.register({
    id: 'm12',
    kind: 'module',
    sections: [
      // ======================================================== 1
      {
        id: 'por-que',
        title: 'Por qué un modelo falla en silencio',
        titleEn: 'Why models fail silently',
        priority: 'core',
        dims: ['monitoreo', 'comunicacion'],
        blocks: [
          { t: 'p', html: `Un lunes, meses después de habilitar el laboratorio C (ya validado y con sus slides en el entrenamiento), el lab C actualiza el perfil de color de su escáner. El <code>seg-worker</code> de <a href="#c04">c04</a> sigue procesando cada slide (lámina) en ${E('≈ 20–30 s')}, la cola está vacía, cero errores, cero reinicios, el SLO de turnaround se cumple. Pero los contornos de tumor del lab C salen más chicos, y los patólogos empiezan a corregir más. El dashboard de servicio está todo verde durante semanas.` },
          { t: 'p', html: `Eso es una <b>falla silenciosa</b>: el servicio responde 200 OK (o, en un batch, escribe su resultado) mientras las predicciones empeoran. Un servidor web roto se nota porque deja de responder; un modelo roto sigue respondiendo con la misma latencia y la misma confianza aparente. Por eso el monitoreo de un sistema de ML tiene capas que un servicio web normal no tiene.` },
          { t: 'table', caption: 'Cinco capas: de abajo hacia arriba, cada una más lenta y más cercana a lo que importa', head: ['Capa', 'Pregunta', 'Ejemplos de señal', 'Qué tan rápido la ves', 'Necesita labels'], rows: [
            ['Infraestructura', '¿Las máquinas están vivas y con recursos?', 'Nodos listos, GPU con errores Xid (los códigos de error que el driver de NVIDIA escribe en el log del kernel), disco, temperatura del Jetson (c03)', 'Segundos', 'No'],
            ['Servicio', '¿Responde bien y a tiempo?', 'p99, tasa de 5xx, saturación; en batch, edad de la cola y DLQ', 'Segundos a minutos', 'No'],
            ['Datos', '¿Los inputs se parecen a los de entrenamiento?', 'Tamaño y formato de imagen (c01), color de tinción por escáner y % de tiles borrosos (c04), mpp faltante', 'Minutos a horas', 'No'],
            ['Modelo', '¿Las predicciones se ven normales? ¿Aciertan?', 'Distribución de predicciones y de confianza; con labels demorados, accuracy o Dice por slice', 'Horas (proxies) a semanas (labels)', 'Los proxies no; la calidad real, sí'],
            ['Negocio', '¿El sistema cumple su propósito?', 'Tasa de aceptación (c01), descartes del SOC (c02), escapes (c03), tasa de correcciones mayores del patólogo (c04)', 'Días a semanas', 'Es el label'],
          ] },
          { t: 'p', html: `Las dos capas de abajo se monitorean como cualquier servicio (y <a href="#c01.monitoreo">c01</a> ya las tiene con sus alertas). Las tres de arriba son lo propio de ML. La trampa es que la señal más confiable (el label) es también la más lenta: entre que el modelo empeora y lo confirmas con labels pueden pasar semanas. El diseño del monitoreo consiste en llenar ese hueco con señales baratas y rápidas que te digan "algo cambió", y dejar para los labels la pregunta "¿empeoró?".` },
          { t: 'table', caption: 'La falla silenciosa típica de cada caso', head: ['Caso', 'Qué cambió', 'Qué dice el dashboard de servicio', 'Qué lo detecta'], rows: [
            ['<a href="#c01.monitoreo">c01</a> marketplace', 'Una versión nueva de la app manda fotos con otro procesamiento (HDR, más compresión)', 'Todo verde', 'Estadísticas de entrada y tasa de baja confianza en minutos; tasa de aceptación en horas'],
            ['<a href="#c02.monitoreo">c02</a> video', 'Una telaraña frente al IR de una cámara; el atardecer cambia de hora con la estación', 'Todo verde', 'Candidatos por cámara contra su propia línea base a la misma hora; descartes del SOC'],
            ['<a href="#c03.monitoreo">c03</a> inspección', 'Polvo de aceite en el lente, una lámpara que pierde intensidad', 'Todo verde', 'Tasa de rechazo contra su línea base, pieza patrón al inicio de turno'],
            ['<a href="#c04.monitoreo">c04</a> patología', 'Perfil de color nuevo en el escáner del lab C (ya habilitado), un lote de reactivo distinto', 'Todo verde', 'PSI de color por escáner en un día; tasa de correcciones mayores en semanas'],
          ] },
          { t: 'p', html: `Fíjate en el patrón: en ninguno de los cuatro cambió el modelo. Cambió el mundo que lo alimenta. Un modelo en producción es una función fija aplicada a un mundo que se mueve, y la mayoría de sus fallas se explican así.` },
          { t: 'diagram', id: 'stack-monitoreo', title: 'El stack de monitoreo: métricas en minutos, logs y labels en días', caption: 'Arriba lo que pasa en cada request o slide; al centro, métricas y alertas; abajo, lo que se calcula por lotes. Toca cada caja y recorre los tres flujos.', spec: STACK },
          { t: 'callout', kind: 'senior', html: `<p>Lo que anota el entrevistador en esta parte: que separas <b>métricas de sistema y de modelo</b>; que dices <b>qué distribución</b> vigilas y <b>contra qué referencia</b> (no "monitoreo el drift"); que sabes <b>cuándo llegan los labels</b> y qué usas mientras tanto; que cada alerta tiene <b>umbral, ventana, severidad y dueño</b>; y que un disparador de reentrenamiento <b>no despliega nada solo</b>. El error típico de <a href="#m01.senales">M1</a>: "monitorearía el modelo" sin ninguno de esos cinco.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"A model fails quietly: the service keeps returning 200s while predictions get worse. So I monitor in layers. System metrics catch the loud failures in minutes. Input and prediction distributions tell me within hours that something changed. And delayed labels, like the pathologists' corrections, tell me weeks later whether quality actually dropped."</p>` },
          { t: 'callout', kind: 'connect', html: `<p>Este módulo cierra el ciclo de vida de <a href="#m01.ciclo-de-vida">M1</a>: los datos y el etiquetado de <a href="#m09">M9</a>, el pipeline de reentrenamiento de <a href="#m10">M10</a> y el despliegue seguro de <a href="#m11">M11</a> dependen de lo que el monitoreo detecte. Los números de latencia y colas vienen de <a href="#m03">M3</a>.</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'sistema',
        title: 'Métricas de sistema: golden signals con detalles de ML',
        titleEn: 'System metrics',
        priority: 'core',
        dims: ['monitoreo', 'estimaciones'],
        blocks: [
          { t: 'p', html: `Hay tres listas famosas de métricas de sistema, y se parecen más de lo que parece. No necesitas memorizar las tres: necesitas saber que existen y usar una con criterio.` },
          { t: 'table', head: ['Método', 'Qué mide', 'Para qué', 'Origen'], rows: [
            ['Golden signals', 'Latencia, tráfico, errores, saturación', 'Cualquier servicio visto desde el usuario', 'Libro de SRE de Google'],
            ['RED', 'Rate (requests/s), Errors, Duration', 'Servicios request/response: la versión corta de los golden signals sin saturación', 'Tom Wilkie'],
            ['USE', 'Utilization, Saturation, Errors', 'Cada recurso: CPU, memoria, GPU, disco, red', 'Brendan Gregg'],
          ] },
          { t: 'p', html: `En la práctica: RED (o golden signals) por servicio, USE por recurso. Lo interesante en ML son los detalles de cada una.` },
          { t: 'h3', text: 'Latencia: percentiles desde histogramas, nunca promedios' },
          { t: 'p', html: `Ya viste en <a href="#m03.percentiles">M3</a> por qué el promedio miente y por qué los p99 de dos pods no se promedian. Para el monitoreo eso tiene una consecuencia concreta: el servicio no calcula percentiles, <b>cuenta observaciones en buckets</b> (un histograma), y Prometheus calcula el cuantil sumando los buckets de todos los pods. Por eso los buckets se eligen alrededor del SLO: el gateway de c01 tiene bordes en 0.15, 0.2 y 0.3 s, justo donde el p99 importa. Un bucket de 0.1 a 1.0 s te daría un p99 "entre 100 ms y 1 s", que no sirve para decidir si rompiste 200 ms.` },
          { t: 'p', html: `Y desglosa por tramo. En c01, <code>classifier_preprocess_seconds</code> (CPU) y <code>classifier_inference_seconds</code> (ida y vuelta a Triton), más la cola y el cómputo dentro de Triton: cuando el p99 sube, un vistazo te dice si es CPU, cola de GPU o cómputo. En c04, lo mismo por slide: descarga, máscara de tejido, inferencia de tiles y stitching.` },
          { t: 'h3', text: 'Errores: qué cuenta como error' },
          { t: 'list', items: [
            '<b>5xx sobre requests válidos</b>: los 4xx (imagen corrupta, tipo no soportado) son culpa del cliente y no entran ni en el numerador ni en el denominador. Si los mezclas, una ráfaga de 4xx "mejora" tu tasa de error.',
            '<b>Timeouts y fallbacks</b>: en c01, un 504 hace que la UI muestre el selector manual. No es un crash, pero sí una predicción que el usuario no recibió: cuéntalo aparte.',
            '<b>Errores "lógicos" que devuelven 200</b>: un tensor con NaN, un top-5 vacío, una máscara de tejido vacía en c04. El servicio no falla; el resultado sí. Cuéntalos con un contador propio (en c03, <code>invalid_scores</code> es uno de los motivos de DIVERT).',
          ] },
          { t: 'h3', text: 'Saturación: la GPU al 100 % no está necesariamente llena' },
          { t: 'table', caption: 'Métricas de GPU que se confunden', head: ['Métrica', 'Qué mide de verdad', 'Trampa'], rows: [
            ['GPU utilization (<code>DCGM_FI_DEV_GPU_UTIL</code>, la de <code>nvidia-smi</code>; <code>nv_gpu_utilization</code> en Triton)', 'Fracción del tiempo en que al menos un kernel estaba corriendo', 'Un kernel chiquito que ocupa 2 de los 58 SMs de una L4 cuenta igual que uno que llena la GPU: 100 % puede ser una GPU casi ociosa en cómputo'],
            ['SM activity (<code>DCGM_FI_PROF_SM_ACTIVE</code>)', 'Fracción del tiempo con al menos un warp activo, promediada sobre todos los SMs', 'Más honesta que la anterior; NVIDIA sugiere que valores bajo 0.5 indican uso ineficiente'],
            ['SM occupancy (<code>DCGM_FI_PROF_SM_OCCUPANCY</code>)', 'Warps residentes sobre el máximo que admite el SM', 'Más ocupación solo ayuda si el kernel está limitado por memoria; no la persigas por sí sola'],
            ['Tensor activity (<code>DCGM_FI_PROF_PIPE_TENSOR_ACTIVE</code>)', 'Fracción de ciclos con los tensor cores activos', 'Si sirves FP16/INT8 y esto está cerca de 0, tu engine no está usando tensor cores'],
            ['Memoria usada (<code>DCGM_FI_DEV_FB_USED</code>)', 'VRAM reservada', 'Frameworks y servidores reservan memoria por adelantado (el caching allocator de PyTorch, los engines de TensorRT): memoria llena no es carga alta'],
          ], note: 'Las métricas de perfilado (<code>DCGM_FI_PROF_*</code>) no están en todas las GPUs ni en todas las configuraciones del exporter: revisa que tu dcgm-exporter las publique.' },
          { t: 'p', html: `Para decidir si falta capacidad, lo que manda no es la utilización sino la <b>cola</b>: el tiempo en la cola de Triton (c01 alerta con <code>TritonQueueTimeHigh</code> sobre 20 ms), el batch promedio (<code>rate(nv_inference_count)</code> ÷ <code>rate(nv_inference_exec_count)</code>: si se acerca a <code>max_batch_size</code>, el dynamic batching ya no tiene margen) y, en el gateway, los requests en vuelo y el CPU throttling. La utilización te dice cuánto trabaja la GPU; la cola te dice si alguien está esperando.` },
          { t: 'p', html: `Y los <b>cold starts</b>: cada réplica nueva (HPA, KEDA, un nodo que vuelve) tarda en bajar la imagen, cargar el engine y calentar. Mídelos como métrica propia (tiempo desde que el pod se crea hasta que está ready) porque son la causa más común de un p99 malo justo cuando escalas (<a href="#m06.cold-starts">M6</a>).` },
          { t: 'h3', text: 'Sistemas batch y asíncronos: la edad de la cola es tu latencia' },
          { t: 'p', html: `En c04 nadie espera una respuesta HTTP: un slide entra a la cola <code>slide-jobs</code> y el resultado aparece en el viewer ${E('≈ 20–30 s')} de proceso después, más lo que haya esperado. El SLO es de turnaround (p95 ≤ 60 min desde que el WSI está en el archivo hasta que el resultado se ve), así que las métricas cambian de forma:` },
          { t: 'table', head: ['Online (c01)', 'Batch / asíncrono (c04)', 'Por qué'], rows: [
            ['p99 de latencia del request', '<b>Edad del mensaje más viejo</b> de la cola (en SQS, <code>ApproximateAgeOfOldestMessage</code>) y turnaround por slide', 'La edad del más viejo es lo que el SLO castiga; la profundidad sola no dice si 50 mensajes son 2 minutos o 2 horas de atraso'],
            ['Requests por segundo', 'Throughput: slides/h y tiles/s por worker', 'Te dice si la capacidad planeada (200 tiles/s por worker) se cumple'],
            ['Tasa de 5xx', 'Mensajes en la <b>DLQ</b> y reintentos por mensaje', 'En c04 un slide va a la DLQ después de 3 intentos; cada uno es un caso sin resultado de IA'],
            ['Saturación de GPU', 'Réplicas actuales vs máximo de KEDA (4) y utilización', 'Si la cola envejece con KEDA al máximo, falta cuota o capacidad'],
            ['—', 'Turnaround por tramo: espera en cola, descarga, inferencia, escritura', 'Igual que el desglose de c01: dice dónde se fue el tiempo'],
          ] },
          { t: 'p', html: `Una asimetría útil: KEDA escala <code>seg-worker</code> por <b>cantidad</b> de mensajes (el scaler de SQS suma visibles y en vuelo, con un objetivo por réplica: <a href="#m06.keda">M6</a>), pero alertas por <b>edad</b>. Escalar por cantidad reacciona rápido; alertar por edad te dice cuándo el SLO está en peligro. Por <a href="#m03.little">la ley de Little</a> se conectan: con 170 slides/h de llegada, una cola de 85 mensajes son ${E('≈ 30 min')} de espera.` },
          { t: 'callout', kind: 'trap', title: 'Trampa: el mensaje venenoso que no envejece la cola', html: `<p>En una cola estándar de SQS, un mensaje recibido 3 o más veces sin borrarse se mueve al final de la cola y <b>deja de contar</b> en <code>ApproximateAgeOfOldestMessage</code>: la métrica pasa a reflejar el siguiente mensaje. Un slide corrupto que tumba al worker una y otra vez no hace sonar la alerta de edad. Por eso la DLQ tiene su propia alerta (c04: DLQ &gt; 0), y por eso la DLQ necesita más retención que la cola original: en colas estándar el mensaje conserva su timestamp de encolado original al moverse, y vence contando desde ahí.</p>` },
          { t: 'h3', text: 'Labels de las métricas: por modelo, por versión y con cardinalidad acotada' },
          { t: 'p', html: `Cada métrica de predicción lleva <code>model_version</code>: durante un canary (<a href="#m11.canary">M11</a>) comparas la versión nueva contra la estable en la misma ventana, y sin ese label no puedes. En c04, además, <code>lab</code> y <code>scanner</code>: el drift de color es por escáner, no global.` },
          { t: 'calc', title: 'Cuántas series crea un histograma (cardinalidad)', rows: [
            { label: 'Histograma de latencia de c01', expr: '11 buckets + "+Inf" + _sum + _count', value: '14 series' },
            { label: 'Con el label source (4 valores)', expr: '14 × 4', value: '56 series por pod' },
            { label: 'Si alguien agrega request_id como label', expr: '14 × 10 M requests/día', value: '140 M series nuevas al día' },
            { label: 'Si en c04 alguien agrega slide_id', expr: '14 × 1,200 slides/día × 30', value: '504,000 series al mes' },
          ], result: 'Cada combinación distinta de labels es una serie de tiempo que Prometheus guarda en memoria e indexa. Los labels van con valores acotados (status, source, model_version, lab, scanner); los ids van a los logs, donde cuestan bytes y no series.' },
          { t: 'callout', kind: 'trap', title: 'Trampa: labels sin límite', html: `<p>Un label con valores ilimitados (user_id, request_id, slide_id, la ruta con ids adentro, el mensaje de error completo) hace crecer las series sin techo hasta que Prometheus se queda sin memoria, normalmente un viernes. Si necesitas saltar del p99 a un request concreto, usa <b>exemplars</b> (un trace id adjunto a algunas observaciones del histograma, como en c01) o los logs.</p>` },
          { t: 'callout', kind: 'skip', html: `<p>No memorices nombres de métricas de DCGM ni de Triton. En la entrevista basta con decir "GPU utilization alone is misleading, I look at queue time and batch size to decide if we need more GPUs" y, en un sistema batch, "I alert on the age of the oldest message, not on queue depth".</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"For the service I track rate, errors and latency percentiles from histograms, broken down by stage: preprocessing, queue and compute. For the batch pipeline the latency metric is the age of the oldest message, plus a dead-letter queue alert, because a poison message doesn't age the queue. Everything is labeled by model version so I can compare a canary against stable."</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'modelo',
        title: 'Métricas de modelo: con y sin labels',
        titleEn: 'Model metrics',
        priority: 'core',
        dims: ['monitoreo', 'aclaracion'],
        blocks: [
          { t: 'p', html: `En tu notebook, "¿qué tan bueno es el modelo?" se contesta con el set de validación: tienes los labels. En producción, casi nunca los tienes en el momento de la predicción. La pregunta del entrevistador es siempre la misma: "¿cómo sabes que el modelo sigue funcionando <i>hoy</i>?". La respuesta tiene dos partes: qué miras mientras no hay labels y cómo usas los que llegan tarde.` },
          { t: 'h3', text: 'Sin labels: señales que dicen "algo cambió"' },
          { t: 'table', head: ['Señal', 'c01 (clasificación)', 'c04 (segmentación)', 'Qué detecta'], rows: [
            ['Distribución de predicciones', 'Categorías predichas vs las 4 semanas previas (PSI)', '% de tumor predicho por slide, por lab', 'El modelo "se fue" hacia algunas clases, o el mundo cambió'],
            ['Confianza', 'Score top-1 (histograma), tasa con top-1 &lt; 0.3', 'Confianza media en la región positiva; fracción de píxeles de tejido con probabilidad cerca del umbral', 'Inputs fuera de distribución: el modelo "duda" más'],
            ['Estadísticas de entrada', 'Bytes, resolución, formato, brillo medio', 'Color de tinción por escáner, % de tiles borrosos, área de tejido, mpp faltante o raro', 'Cambios del lado del cliente o del escáner'],
            ['Tasa por clase o por resultado', 'Top-20 categorías vs línea base', '% de slides con QC flags, % sin tumor detectado', 'Cambios de mezcla o un paso que falla en silencio'],
          ] },
          { t: 'p', html: `Ninguna de estas señales prueba que el modelo empeoró. Una confianza más baja puede significar inputs más difíciles con predicciones igual de buenas; una distribución de predicciones distinta puede ser una temporada real. Lo que te dan es un <b>aviso rápido y barato</b> para ir a mirar muestras y, si hace falta, etiquetar una muestra de lo nuevo.` },
          { t: 'callout', kind: 'trap', title: 'La confianza no es accuracy', html: `<p>Una red mal calibrada puede estar muy segura y equivocada: ante un escáner nuevo, un segmentador puede dar probabilidades de 0.95 sobre regiones que un patólogo no marcaría. La confianza sirve como señal de <b>cambio</b> (se movió respecto de su línea base), no como estimador de accuracy. Herramientas como NannyML estiman el desempeño sin labels a partir de la confianza, pero suponen un modelo calibrado y que no hubo concept drift; trátalo como un proxy más, no como la verdad.</p>` },
          { t: 'h3', text: 'Con labels demorados: el join que casi todos olvidan' },
          { t: 'p', html: `Los labels llegan tarde y por otro camino. Para usarlos, cada predicción tiene que tener un <b>id</b> que el label también traiga. En c01, el backend guarda el <code>X-Request-ID</code> de cada foto con el borrador y los eventos del caller (<code>suggestion_shown</code>, <code>category_selected</code>) lo repiten. En c04, el <code>slide_id</code> y la <code>model_version</code> viajan con el resultado al viewer, y la corrección del patólogo vuelve con los dos. Después, un job une predicción y label y calcula la métrica por slice. Si no guardaste el id en el momento de la predicción, no hay join posible y tu único label es anecdótico.` },
          { t: 'table', caption: 'Proxy rápido vs label fuerte, caso por caso', head: ['Caso', 'Proxy (minutos a horas)', 'Label (con su retraso)', 'Sesgo del label'], rows: [
            ['<a href="#c01.monitoreo">c01</a>', 'Tasa de baja confianza, PSI de categorías', 'Aceptación de la sugerencia (minutos a horas); re-categorización por moderadores (días)', 'El vendedor ve la sugerencia: la aceptación está anclada a lo que el modelo mostró'],
            ['<a href="#c02.monitoreo">c02</a>', 'Tasa de rechazo del verificador, candidatos por cámara', 'Descartes del SOC (horas); walk tests (mensual)', 'El SOC solo ve lo que el sistema alertó: los descuidos no aparecen; el walk test es la única medida directa del recall'],
            ['<a href="#c03.monitoreo">c03</a>', 'Tasa de REJECT vs línea base, score de anomalía', 'Veredicto del inspector sobre rechazados (horas); escapes reportados (semanas)', 'Solo se revisan las piezas rechazadas: ves la precisión, no el recall'],
            ['<a href="#c04.monitoreo">c04</a>', 'Color por escáner, % de tumor predicho, confianza', 'Tasa de correcciones mayores del patólogo (horas a días); auditoría mensual independiente (un mes)', 'El patólogo vio la propuesta: "aceptado sin cambios" no es "correcto" (automation bias)'],
          ] },
          { t: 'p', html: `La columna de sesgo es la que separa a un senior. Casi todo label de producción está filtrado por lo que el modelo hizo: en c03 solo inspeccionas lo que el modelo rechazó, así que una caída de recall es invisible hasta que la armadora reporta un escape. La defensa es siempre la misma: una <b>muestra que no depende del modelo</b>. En c01, un holdout de ${E('≈ 1 %')} sin sugerencias; en c03, piezas patrón y una muestra de piezas aprobadas; en c04, una auditoría mensual de slides al azar anotados de forma independiente, sin ver la propuesta.` },
          { t: 'h3', text: 'La métrica fuerte de c04: tasa de correcciones mayores' },
          { t: 'p', html: `En c04, un <b>major edit</b> es una corrección que cambia más del 20 % del área de tumor propuesta. Es un label barato (el patólogo corrige de todos modos antes de firmar), llega en horas o días, y está pegado al uso real. Se sigue por lab, escáner y tipo de espécimen, en ventanas de 4 semanas contra su línea base. ¿Por qué 4 semanas y no 1? Por el ruido de muestreo:` },
          { t: 'calc', title: 'Intervalo al 95 % de la tasa de major edits (línea base supuesta 10 %)', rows: [
            { label: 'Slides por lab en 4 semanas', expr: '≈ 400/día × 28 días', value: E('≈ 11,200'), note: 'si los 3 labs aportan parecido a los 1,200/día' },
            { label: 'Ventana de 4 semanas, un lab', expr: '1.96 × √(0.1 × 0.9 / 11,200)', value: '± 0.56 pp' },
            { label: 'Ventana de 1 semana, un lab', expr: '1.96 × √(0.1 × 0.9 / 2,800)', value: '± 1.1 pp' },
            { label: 'Un slice chico (500 slides en 4 semanas)', expr: '1.96 × √(0.1 × 0.9 / 500)', value: '± 2.6 pp' },
          ], result: 'Con 4 semanas, una subida de 10 % a 12 % en un lab se distingue del ruido; con una semana, apenas. En un slice chico (un tipo de espécimen raro) solo ves cambios grandes: ahí la señal rápida es el drift de entrada, y la confirmación, la auditoría.' },
          { t: 'callout', kind: 'note', html: `<p>La tasa de correcciones también se mueve por cosas que no son el modelo: un cambio de UI del viewer, patólogos nuevos que corrigen distinto, una guía de anotación actualizada. Parte la métrica por patólogo (solo para el análisis del equipo, nunca como evaluación de personas) y anota los cambios de producto en el dashboard.</p>` },
          { t: 'h3', text: 'Métricas por slice, siempre' },
          { t: 'p', html: `El promedio esconde el slice roto. En c04 el lab C es un tercio del volumen: si su Dice cae 0.12 y los labs A y B siguen igual, el promedio baja apenas ${E('≈ 0.04')} y parece ruido. Cada métrica de modelo se calcula por los slices que importan (lab, escáner, tipo de espécimen, lote de tinción en c04; app vs web y categorías grandes vs long tail en c01) con un mínimo de muestras por slice, para no alertar con cinco datos.` },
          { t: 'callout', kind: 'senior', html: `<p>Separa las tres preguntas: "¿cambió algo?" (proxies sin labels, en minutos), "¿empeoró?" (labels demorados, en días o semanas) y "¿mis labels mienten?" (una muestra independiente del modelo). Un candidato que dice de dónde salen sus labels, con cuánto retraso y con qué sesgo, suena a alguien que ya operó un modelo.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"Labels arrive late and biased. The pathologist sees the proposal before correcting it, so 'accepted without edits' doesn't mean correct. I track the major-edit rate per lab and scanner over four-week windows, and I keep a small monthly audit where slides are annotated independently, without the model's output, to measure the bias."</p>` },
        ],
      },

      // ======================================================== 4
      {
        id: 'drift',
        title: 'Data drift, concept drift y label shift',
        titleEn: 'Data drift vs concept drift vs label shift',
        priority: 'core',
        dims: ['monitoreo', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `"Drift" se usa para todo. En la entrevista conviene separarlo en tres, porque cada uno se detecta distinto y se arregla distinto. Primero con ejemplos, después con notación.` },
          { t: 'list', items: [
            '<b>Data drift (covariate shift)</b>: cambian los inputs, no la regla. El lab C cambia el perfil de color de su escáner: el tejido tumoral sigue siendo tumoral, pero se ve más rosado. En c01, un celular nuevo con HDR agresivo. En c02, la luz del atardecer cambia de hora con la estación.',
            '<b>Concept drift</b>: cambia la regla que une input y label, aunque los inputs se vean iguales. La armadora de c03 decide que una rebaba de 0.3 mm ahora es defecto; los patólogos de c04 acuerdan una guía nueva que incluye el estroma tumoral en la región. Mismas imágenes, otra respuesta correcta.',
            '<b>Label shift (prior shift)</b>: cambia la proporción de clases, no cómo se ve cada una. En diciembre, c01 recibe muchos más juguetes; si un lab de c04 empieza a mandar más resecciones y menos biopsias, cambia cuánto tumor hay por slide.',
          ] },
          { t: 'p', html: `En notación, escribiendo x para el input e y para el label: data drift es un cambio en p(x) con p(y|x) fija; concept drift, un cambio en p(y|x); label shift, un cambio en p(y) con p(x|y) fija. No hace falta más que eso.` },
          { t: 'table', caption: 'Los tres, lado a lado', head: ['', 'Data drift (covariate)', 'Concept drift', 'Label shift'], rows: [
            ['Qué cambia', 'p(x): cómo se ven los inputs', 'p(y|x): qué es lo correcto', 'p(y): cuánto hay de cada clase'],
            ['Ejemplo en visión', 'Escáner, cámara, luz o compresión nuevos', 'Nueva definición de defecto o nueva guía de anotación', 'Mezcla estacional de categorías; más resecciones que biopsias'],
            ['Cómo lo detectas', 'Distribución de inputs o embeddings contra la referencia (PSI, KS, domain classifier)', 'Solo con labels: la métrica cae sin que los inputs se muevan', 'Distribución de predicciones (y de labels cuando llegan)'],
            ['¿Necesita labels?', 'No para detectarlo; sí para saber si dañó', 'Sí', 'No para sospecharlo; sí para confirmarlo'],
            ['Qué haces', 'Etiquetar muestras del dominio nuevo, reentrenar o afinar; a veces normalizar el input', 'Reetiquetar con la regla nueva y reentrenar: los labels viejos ya son incorrectos', 'Revisar umbrales y calibración por clase; reentrenar con la mezcla actual si hace falta'],
            ['En c04', 'Perfil de color del escáner del lab C → PSI de color', 'La guía cambia qué cuenta como tumor → suben las correcciones en <b>todos</b> los labs a la vez', 'Un lab manda más resecciones → cambia el % de tumor predicho sin que cambie el color'],
          ] },
          { t: 'p', html: `El renglón de c04 muestra el diagnóstico en la práctica. Si las correcciones suben <b>solo en el lab C</b> y el PSI de color de su escáner está alto, es data drift. Si suben <b>en todos los labs a la vez</b> y ningún input se movió, busca un cambio de concepto o de proceso: una guía nueva, un cambio en el viewer, patólogos nuevos. Si solo se movió la distribución de predicciones y las correcciones no, probablemente es la mezcla de casos.` },
          { t: 'callout', kind: 'trap', title: 'Training-serving skew no es drift', html: `<p>Si el modelo rinde peor desde el primer día del despliegue, o justo después de un cambio de código o de librería, sospecha de <b>skew</b>: tu pipeline de serving calcula el input distinto que el de entrenamiento (RGB vs BGR, otro resize, leer el nivel equivocado de la pirámide del WSI). El mundo no cambió; tu código sí. Reentrenar no lo arregla, y un detector de drift lo reporta igual que un drift real. Se separan pasando los mismos ejemplos por los dos caminos: <a href="#m09.skew">M9</a>.</p>` },
          { t: 'callout', kind: 'why', title: 'Drift no significa que el modelo empeoró', html: `<p>Un detector de drift compara distribuciones; no sabe nada de tu accuracy. Si los vendedores de c01 empiezan a subir fotos mejor iluminadas, el PSI de brillo sube y el modelo probablemente acierta <i>más</i>. Al revés, un concept drift puro deja los inputs idénticos y el PSI en cero mientras la accuracy cae. Por eso nunca reentrenas "porque hubo drift": el drift abre una investigación, y la decisión la toman los labels (<a href="#m12.reentrenar">sección 8</a>).</p>` },
          { t: 'callout', kind: 'skip', html: `<p>La literatura tiene más nombres (subpopulation shift, prior probability shift, virtual drift, gradual vs sudden vs recurring). Con los tres de la tabla y el skew cubres cualquier entrevista. Existen técnicas para corregir label shift reponderando las predicciones de un clasificador (p. ej. Lipton et al., ICML 2018), pero rara vez te las piden.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"I separate three things. Covariate drift, like the new scanner in lab C, shows up in input statistics within a day. Concept drift, like a new annotation guideline, only shows up in labels, and it hits all labs at once. And training-serving skew is a bug in my own pipeline, so I rule it out first by running reference slides through both paths."</p>` },
        ],
      },

      // ======================================================== 5
      {
        id: 'deteccion-drift',
        title: 'Detectar drift: PSI, KS, embeddings y el problema de las muchas alertas',
        titleEn: 'Drift detection',
        priority: 'core',
        dims: ['monitoreo', 'estimaciones'],
        blocks: [
          { t: 'p', html: `Detectar drift es comparar dos muestras: una de <b>referencia</b> y una <b>actual</b>. Las decisiones importantes son qué variable resumes, contra qué referencia comparas, en qué ventana y con qué medida. Empiezo por la medida más usada en la industria, con números.` },
          { t: 'h3', text: 'PSI con un ejemplo de c04' },
          { t: 'p', html: `Tomas el matiz (hue) de los píxeles de tejido de cada slide y lo resumes en 5 bins. La referencia son los slides de entrenamiento del modelo actual, que desde el reentrenamiento que habilitó al lab C incluyen los labs A, B y C; la muestra actual, los slides de ayer del escáner Y (lab C). El <b>Population Stability Index</b> suma, por bin, la diferencia de proporciones por el logaritmo de su cociente:` },
          { t: 'table', caption: 'PSI del matiz de tejido: escáner Y contra la referencia de entrenamiento (A, B y C)', head: ['Bin de matiz', 'Referencia', 'Actual (escáner Y)', 'Actual − ref.', 'ln(actual / ref.)', 'Aporte'], rows: [
            ['1 (más violeta)', '0.10', '0.04', '−0.06', '−0.916', '0.055'],
            ['2', '0.20', '0.12', '−0.08', '−0.511', '0.041'],
            ['3', '0.40', '0.34', '−0.06', '−0.163', '0.010'],
            ['4', '0.20', '0.30', '+0.10', '+0.405', '0.041'],
            ['5 (más rosado)', '0.10', '0.20', '+0.10', '+0.693', '0.069'],
            ['<b>PSI</b>', '', '', '', '', '<b>≈ 0.215</b>'],
          ], note: 'Cada aporte es (actual − ref.) × ln(actual / ref.), siempre ≥ 0: si un bin gana o pierde masa, suma. Calculado con el snippet de abajo.' },
          { t: 'p', html: `En fórmula: PSI = Σ (actual<sub>i</sub> − ref<sub>i</sub>) × ln(actual<sub>i</sub> / ref<sub>i</sub>). Es la divergencia de Kullback–Leibler simétrica entre las dos distribuciones binneadas. Un dato que ayuda a calibrar la intuición: para una variable normal cuya media se corre δ desviaciones estándar, el PSI es ${E('≈ δ²')} (con bins finos). PSI 0.1 es una corrida de ≈ 0.3 σ; PSI 0.25, de ≈ 0.5 σ.` },
          { t: 'table', caption: 'Umbrales habituales (convenciones, no leyes)', head: ['PSI', 'Lectura habitual', 'En los casos'], rows: [
            ['&lt; 0.1', 'Estable', '—'],
            ['0.1 – 0.25', 'Cambio moderado: mirar', 'c01 y c04 actúan desde 0.2'],
            ['&gt; 0.25', 'Cambio grande', '—'],
          ], note: 'Los cortes 0.1 y 0.25 vienen de la práctica de credit scoring y se repiten por costumbre; muchos equipos usan 0.2 como umbral de acción, como c01 (PSI &gt; 0.2 sostenido 3 días) y c04 (PSI &gt; 0.2 por escáner). Ningún número es universal: depende de cuántos bins uses, del tamaño de muestra y de la variable. Calíbralo mirando cuánto se mueve el PSI entre semanas normales. Verás la misma regla escrita como 0.1/0.2 (así la usan c01 y los archivos de c04): el corte superior varía entre 0.2 y 0.25 según la fuente; lo que importa es calibrarlo.' },
          { t: 'callout', kind: 'trap', title: 'Trampas del PSI', html: `<ul><li><b>Bins vacíos</b>: ln(0) explota. Con un bin de referencia al 10 % y el actual en 0, el resultado depende del epsilon que elijas (con un ejemplo, 0.56 con 10⁻³ y 1.26 con 10⁻⁶). Arma los bins con cuantiles de la referencia (ninguno queda vacío de ese lado), agrupa bins raros y fija el epsilon.</li><li><b>Muchos bins con pocos datos</b>: con 500 categorías en c01, las raras meten ruido; c01 lo resuelve con las ≈ 30 categorías padre.</li><li><b>Bordes que cambian</b>: si recalculas los bins cada día, comparas cosas distintas. Los bordes se fijan con la referencia.</li></ul>` },
          { t: 'code', title: 'PSI con numpy', caption: 'Corrió tal cual: imprime 0.215, 0.002 y 0.245.', files: [ { name: 'psi.py', lang: 'python', code: PSI_PY } ] },
          { t: 'h3', text: 'Test KS: la trampa del n grande' },
          { t: 'p', html: `El test de Kolmogorov–Smirnov de dos muestras compara las distribuciones acumuladas de una variable continua. Su estadístico D es la máxima distancia vertical entre las dos curvas (entre 0 y 1), y te da un p-value. El problema en monitoreo es el tamaño de muestra: c04 procesa ${E('≈ 3.6 M tiles/día')}. Con un millón de valores por lado, cualquier diferencia minúscula es "estadísticamente significativa":` },
          { t: 'kv', items: [
            ['n = 1 M por lado, corrida de 0.02 σ', 'D ≈ 0.008 · p ≈ 10⁻²⁹', 'Significativo e irrelevante'],
            ['n = 1,000 por lado, corrida de 0.3 σ', 'D ≈ 0.15 · p ≈ 10⁻⁹', 'Significativo y relevante'],
          ] },
          { t: 'p', html: `El p-value mide cuánta evidencia tienes de que <i>hay</i> una diferencia, y con n enorme casi siempre la hay. Lo que te importa es <b>cuánto</b> cambió: el estadístico D, el PSI o una distancia, con un umbral de tamaño de efecto calibrado con semanas normales. Evidently lo resuelve así por defecto: para columnas numéricas usa KS con muestras de hasta 1,000 y la distancia de Wasserstein por encima (cuánta masa hay que mover, y qué tan lejos, para convertir una distribución en la otra; un tamaño de efecto, no un p-value; Evidently la normaliza por la desviación estándar de la referencia y usa umbral 0.1); para categóricas, chi-cuadrado y Jensen–Shannon (una versión simétrica y acotada de la divergencia KL).` },
          { t: 'code', title: 'La trampa del n grande, reproducida', caption: 'Corrió con scipy: n = 1 M da p ≈ 10⁻²⁹ con un D minúsculo.', files: [ { name: 'ks.py', lang: 'python', code: KS_PY } ] },
          { t: 'p', html: `Para variables <b>categóricas</b> (categoría predicha en c01, tipo de espécimen en c04) el equivalente es el test chi-cuadrado sobre la tabla de conteos, con la misma trampa del n grande; el PSI sobre las proporciones funciona igual que con bins.` },
          { t: 'h3', text: 'Imágenes: drift en embeddings' },
          { t: 'p', html: `Estadísticas de píxeles (color, brillo, nitidez) atrapan cambios de adquisición, pero no cambios de contenido: un tipo de tejido que el modelo nunca vio puede tener el mismo color medio. Para eso se usan <b>embeddings</b>: el vector de una capa intermedia de tu propio modelo (o de un encoder genérico) por tile o por imagen. Tres formas de compararlos, de la más simple a la más potente:` },
          { t: 'table', head: ['Método', 'Cómo', 'A favor', 'En contra'], rows: [
            ['Distancia entre medias', 'Distancia euclidiana o coseno entre el embedding promedio de la referencia y el de hoy', 'Trivial de calcular y de guardar', 'Solo ve corridas de la media; un cambio de forma con la misma media pasa'],
            ['MMD (maximum mean discrepancy)', 'Distancia entre distribuciones con un kernel; el umbral sale de un test por permutaciones', 'Detecta cambios de forma, con fundamento estadístico', 'Cuadrático en n: se hace sobre muestras (miles, no millones)'],
            ['Domain classifier', 'Entrenas un clasificador para distinguir "referencia" de "hoy"; si su ROC AUC es ≈ 0.5, no se distinguen', 'Potente, interpretable (AUC) y te dice <i>qué</i> ejemplos son distintos', 'Entrenar un modelo en cada chequeo; AUC 0.6 con n grande puede ser irrelevante'],
          ] },
          { t: 'p', html: `Evidently usa el domain classifier como método por defecto para embeddings (drift si ROC AUC &gt; 0.55 con más de 1,000 muestras). El estudio de Rabanser, Günnemann y Lipton (<i>Failing Loudly</i>, NeurIPS 2019) encontró que reducir dimensión con un clasificador ya entrenado y aplicar tests de dos muestras sobre esa representación funcionaba mejor entre los métodos que probaron, y que el domain classifier es útil para caracterizar el cambio y ver si es dañino. Traducido a c04: guarda un embedding por tile para una <b>muestra</b> de tiles por slide (<a href="#m12.logging-predicciones">sección 7</a>), no para los 3,000.` },
          { t: 'h3', text: 'Referencia y ventanas' },
          { t: 'table', head: ['Referencia', 'Responde', 'Trampa'], rows: [
            ['Datos de entrenamiento', '¿El modelo está viendo algo que no aprendió?', 'Detecta todo lo que cambió desde que se entrenó, también lo benigno; alerta sin parar si el mundo ya se movió'],
            ['Ventana reciente (p. ej. 4 semanas previas, como c01)', '¿Cambió algo esta semana?', 'Un drift lento (1 % por semana) nunca se ve: cada semana se parece a la anterior'],
            ['La misma franja de semanas anteriores (c02: misma cámara, misma hora)', '¿Esto es raro para este momento?', 'Necesita historia suficiente por franja'],
          ] },
          { t: 'p', html: `Usa dos: contra entrenamiento (lo que el modelo conoce) y contra una ventana reciente (lo que cambió de golpe). La referencia de entrenamiento se versiona con el modelo: cuando el lab C entró al entrenamiento, se reconstruyó con A, B y C. Contra la referencia original (solo A y B), el PSI de C salía alto desde el día 1 (por eso pasó por modo silencioso, y c04 silencia esa alerta para C hasta validarlo): esa comparación dice "el modelo nunca vio este color", no "cambió", y no puede detectar un cambio nuevo. Por eso, además, cada lab y escáner se compara contra sus propias 4 semanas previas. Y la ventana actual tiene que juntar suficientes datos por slice: en c04, un día de un escáner son ${E('≈ 400 slides')}, suficientes para el color; un tipo de espécimen raro necesita semanas.` },
          { t: 'callout', kind: 'trap', title: 'Muchos tests, muchas falsas alarmas', html: `<p>Con 3 labs × 4 estadísticas, cada día a α = 0.05, haces 12 tests diarios. Aunque nada cambie, esperas ${E('≈ 18 falsas alarmas al mes')} y una probabilidad de ≈ 46 % de al menos una por día. Así nace la <b>fatiga de alertas</b>. Defensas: umbrales de tamaño de efecto en vez de p-values, exigir que el cambio se sostenga (c01: 3 días), corrección por comparaciones múltiples si usas p-values, y agrupar: una alerta por escáner con todas sus estadísticas, no doce.</p>` },
          { t: 'h3', text: 'Herramientas' },
          { t: 'table', caption: 'Estado a septiembre de 2026: verifica versión y licencia antes de elegir', head: ['Herramienta', 'Qué es', 'Para imágenes', 'Ojo con'], rows: [
            ['Evidently', 'Librería open source (Apache 2.0) de reportes y tests de drift y calidad; también plataforma', 'Drift de embeddings (domain classifier, MMD, distancias)', 'La API nueva es la predeterminada desde 0.7 (abril de 2025): los ejemplos viejos no corren tal cual'],
            ['NannyML', 'Librería open source (Apache 2.0): drift y estimación de desempeño sin labels (CBPE para clasificación, DLE para regresión)', 'No: orientada a datos tabulares', 'La estimación supone calibración y ausencia de concept drift; revisa la actividad del repo (la última versión en PyPI es de julio de 2025)'],
            ['whylogs', 'Librería open source para perfiles estadísticos mergeables de datos, sin guardar los datos crudos', 'Perfiles de estadísticas de imagen', 'Apple adquirió WhyLabs en 2025 y el SaaS se discontinuó; la librería sigue publicada, pero verifica su mantenimiento'],
            ['Alibi Detect (Seldon)', 'Librería de detectores: KS, MMD, clasificador, kernels aprendidos, outliers', 'Sí, con preprocesamiento por modelo', 'Licencia Business Source License 1.1 desde enero de 2024: gratis para uso no productivo; en producción, licencia comercial'],
            ['Monitores de la nube', 'SageMaker Model Monitor, Vertex AI Model Monitoring, Azure ML model monitoring', 'Orientados sobre todo a datos tabulares; para imágenes, estadísticas o contenedor propios', 'Precio y tipos de datos soportados cambian: revisa la documentación'],
          ] },
          { t: 'p', html: `En la entrevista, las herramientas pesan poco. Lo que pesa es que digas <b>qué variable</b>, <b>qué referencia</b>, <b>qué medida y qué umbral</b>, y <b>qué pasa cuando dispara</b>. Para c04, un job de 50 líneas con numpy que calcula el PSI de color por escáner y lo publica como métrica es una respuesta perfectamente senior.` },
          { t: 'callout', kind: 'interview', html: `<p>"For the scanners I compute a PSI on the tissue color histogram per scanner, daily, against the training reference, and act above 0.2. At our volume every KS test would be significant, so I use effect sizes, not p-values. For content changes I compare tile embeddings on a sample, with a domain classifier: if it can tell today from the reference, something changed."</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'prometheus-grafana',
        title: 'Prometheus, Grafana y alertas por SLO',
        titleEn: 'Prometheus, Grafana, alerts and SLOs',
        priority: 'core',
        dims: ['monitoreo', 'arquitectura'],
        blocks: [
          { t: 'p', html: `Prometheus es el estándar de facto para métricas en Kubernetes, y es lo que usan los archivos de <a href="#c01.archivos">c01</a>, <a href="#c02.archivos">c02</a> y <a href="#c03.archivos">c03</a>. Funciona por <b>pull</b>: cada servicio expone <code>/metrics</code> en texto plano y Prometheus hace scrape cada 15–30 s. Si un target deja de responder, la serie <code>up</code> baja a 0 y lo sabes (con push, un servicio muerto simplemente se calla).` },
          { t: 'h3', text: 'Cuatro tipos de métrica' },
          { t: 'table', head: ['Tipo', 'Qué es', 'Ejemplo', 'Cómo se consulta'], rows: [
            ['Counter', 'Número que solo sube (se reinicia a 0 si el proceso reinicia)', '<code>classifier_requests_total</code>', 'Siempre con <code>rate()</code> o <code>increase()</code>, que manejan los reinicios'],
            ['Gauge', 'Valor que sube y baja', 'Requests en vuelo, réplicas, PSI del día', 'Directo, o <code>avg_over_time</code>'],
            ['Histogram', 'Conteos por bucket + suma + total', '<code>classifier_request_latency_seconds</code>, <code>classifier_top1_score</code>', '<code>histogram_quantile</code> sobre los buckets sumados'],
            ['Summary', 'Cuantiles calculados en el cliente', 'Poco usado en servicios con réplicas', 'No se puede agregar entre pods; el cliente de Python ni siquiera calcula cuantiles'],
          ] },
          { t: 'p', html: `Histograma para latencia y para distribuciones de score: se agrega entre pods y se consulta en cualquier ventana. Desde Prometheus 3.8 los <b>native histograms</b> (buckets exponenciales automáticos, más precisos y baratos) son estables, pero hay que activar su scrape explícitamente y el cliente tiene que emitirlos; con los clásicos no te equivocas.` },
          { t: 'code', title: 'Instrumentar un servicio con prometheus_client', caption: 'Corrió tal cual; la segunda pestaña es un extracto real de su <code>/metrics</code>.', files: [
            { name: 'metricas.py', lang: 'python', code: METRICAS_PY },
            { name: '/metrics (extracto)', lang: 'text', code: METRICAS_OUT },
          ] },
          { t: 'h3', text: 'PromQL que sí vas a usar' },
          { t: 'code', title: 'Tres consultas', files: [
            { name: 'p99.promql', lang: 'promql', code: '# p99 del servicio en ventanas de 5 min: primero sumar buckets entre pods, después el cuantil\nhistogram_quantile(0.99,\n  sum by (le) (rate(classifier_request_latency_seconds_bucket[5m])))' },
            { name: 'error-ratio.promql', lang: 'promql', code: '# Fracción de 5xx sobre requests válidos (los 4xx no cuentan en ningún lado)\nsum(rate(classifier_requests_total{status=~"5.."}[5m]))\n  / sum(rate(classifier_requests_total{status!~"4.."}[5m]))' },
            { name: 'batch-promedio.promql', lang: 'promql', code: '# Batch promedio en Triton: inferencias por ejecución (cerca de max_batch_size = sin margen)\nsum(rate(nv_inference_count{model="classifier"}[5m]))\n  / sum(rate(nv_inference_exec_count{model="classifier"}[5m]))' },
          ] },
          { t: 'h3', text: 'Reglas de alerta' },
          { t: 'p', html: `Una regla tiene una expresión, un <code>for</code> (cuánto tiempo debe sostenerse antes de disparar: filtra picos de un GC o de un deploy), labels (<code>severity</code>, que Alertmanager usa para enrutar) y annotations (resumen, descripción y <code>runbook_url</code>). Las reglas completas de c01 están en su <a href="#c01.archivos">sección 13</a>; aquí va lo que las hace buenas o malas.` },
          { t: 'list', items: [
            '<b>Alerta por síntomas, no por causas</b>: el p99 alto afecta al usuario; la CPU al 90 % quizá no. Las causas van a dashboards y a warnings.',
            '<b>Protege contra el tráfico bajo</b>: c01 exige ≥ 1 req/s para su alerta de 5xx; con 20 requests de madrugada, un error sería el 5 %.',
            '<b>Una serie ausente no dispara</b>: si el servicio muere, sus métricas desaparecen y la regla no evalúa nada. Alerta sobre <code>up == 0</code> o con <code>absent()</code>, y del lado de quien espera la señal (c02 evalúa el heartbeat del edge en la nube).',
            '<b>Graba lo caro</b>: una regla de grabación precalcula una expresión cada minuto (c01 graba la fracción de baja confianza para compararla con su promedio de 7 días).',
          ] },
          { t: 'h3', text: 'SLOs, error budget y burn rate' },
          { t: 'p', html: `Un umbral fijo ("p99 &gt; 200 ms durante 10 min") funciona, pero no sabe cuánto importa. La versión madura parte del <b>SLO</b> que dijiste en requisitos. Con 99.9 % de disponibilidad en 30 días, el <b>error budget</b> es 0.1 %: 43.2 minutos de caída, o 300,000 requests fallidos en el mes de c01 (10 M/día × 30 × 0.001). El <b>burn rate</b> es qué tan rápido consumes ese presupuesto respecto del ritmo que lo agotaría justo al final del mes: burn rate 1 = tasa de error de 0.1 % sostenida.` },
          { t: 'calc', title: 'Burn rates del SRE Workbook para 99.9 % en 30 días (720 h)', rows: [
            { label: 'Page rápido', expr: '2 % del presupuesto en 1 h → 0.02 × 720 / 1', value: '14.4×', note: 'tasa de error &gt; 14.4 × 0.1 % = 1.44 %; agota el mes en 720 / 14.4 = 50 h' },
            { label: 'Page lento', expr: '5 % del presupuesto en 6 h → 0.05 × 720 / 6', value: '6×', note: 'tasa &gt; 0.6 %; agota el mes en 5 días' },
            { label: 'Ticket', expr: '10 % del presupuesto en 3 días → 0.10 × 720 / 72', value: '1×', note: 'tasa &gt; 0.1 %' },
            { label: 'c01: una hora a 14.4×', expr: '416,667 requests/h × 1.44 %', value: '≈ 6,000 errores', note: '= 2 % de 300,000' },
          ], result: 'Cada alerta exige la ventana larga y una corta de 1/12 de su duración (1 h y 5 min; 6 h y 30 min; 3 días y 6 h): la larga confirma que el consumo es real, la corta hace que la alerta se apague pronto cuando el problema se arregla.' },
          { t: 'code', title: 'Alertas multi-window, multi-burn-rate para c01', caption: 'Parseado con PyYAML; cada expresión validada con un parser de PromQL. El SRE Workbook pone el de 6× como page; c01 lo manda a ticket porque su camino tiene fallback (el selector manual).', files: [ { name: 'slo-rules.yml', lang: 'yaml', code: SLO_YML } ] },
          { t: 'p', html: `Para latencia es igual con otra razón: si el SLO es "99 % de los requests en menos de 200 ms", el presupuesto es 1 % de requests lentos, y la fracción lenta sale de los buckets: 1 − (bucket <code>le="0.2"</code> ÷ count). Herramientas como Sloth o Pyrra generan estas reglas desde una definición corta del SLO.` },
          { t: 'callout', kind: 'trap', title: 'Burn rate con SLOs bajos y poco volumen: c04', html: `<p>El SLO de turnaround de c04 es p95 ≤ 60 min: el presupuesto es 5 % de slides tarde (${E('≈ 1,800')} de 36,000 al mes). Los factores del SRE Workbook no dependen del objetivo: 14.4× sigue siendo 2 % del presupuesto mensual en 1 h y 6×, 5 % en 6 h (la cuenta 0.02 × 720 / 1 de arriba no usa el 99.9 %). Solo exigen factor × presupuesto ≤ 1: con 5 % el burn rate máximo posible es 1 / 0.05 = 20, y 14.4× significa que el 72 % de los slides de la última hora llegó tarde (6×, el 30 % en 6 h). c04 conserva los dos factores en <code>TurnaroundSLOBurn</code>, con dos ajustes. <b>Poco volumen</b>: con ${E('≈ 86 slides/h')}, una ventana de 5 min tiene ≈ 7 slides y una sola demora mueve la fracción 14 puntos; por eso la regla exige al menos 10 slides terminados en la ventana larga. Y como 72 % tarde ya es un incidente grave (y el histograma solo cuenta slides que terminaron), la alerta que avisa primero es una <b>adelantada</b>: la edad del mensaje más viejo &gt; 30 min sostenida 10 min (<code>SlideQueueBacklog</code>) suena a los ≈ 40 min de espera y deja ≈ 20 min para salvar el SLO, menos un cold start de ${E('3–5 min')} si no hay ningún worker arriba. El SRE Workbook discute este problema de los servicios de poco tráfico.</p>` },
          { t: 'h3', text: 'Page, ticket y a quién le llega' },
          { t: 'table', head: ['Severidad', 'Cuándo', 'Canal', 'Ejemplos'], rows: [
            ['Page', 'El usuario está afectado ahora y alguien puede actuar ahora', 'Despierta al on-call (PagerDuty, Opsgenie o similar)', 'c01: p99, 5xx, Triton no listo; c02: sitio ciego; c03: deadline misses'],
            ['Warning', 'Una causa que anticipa un page', 'Canal del equipo, horario laboral', 'Cola de Triton alta, GPU saturada, disco del edge'],
            ['Ticket', 'Calidad del modelo y tendencias: se analiza con datos, no a las 3 a. m.', 'Cola de trabajo del equipo de ML', 'PSI, baja confianza, falsas alarmas, correcciones'],
          ] },
          { t: 'p', html: `Alertmanager hace el enrutamiento: agrupa alertas del mismo incidente en una notificación, deduplica entre réplicas de Prometheus, <b>inhibe</b> las que son consecuencia de otra (c03: si la planta no tiene enlace, un solo ticket en vez de cinco pages) y permite <b>silenciar</b> durante un mantenimiento. Grafana también puede evaluar alertas; elige un solo lugar donde viven las reglas, versionado en git.` },
          { t: 'h3', text: 'Dashboards en Grafana' },
          { t: 'list', items: [
            '<b>Arriba, el SLO</b>: presupuesto restante del mes y burn rate actual. Lo primero que mira el on-call.',
            '<b>Después, RED por tramo</b>: tasa, errores y p50/p99, con el desglose (preprocess / cola / cómputo en c01; cola / descarga / inferencia / escritura en c04) y marcadores de deploy.',
            '<b>Recursos</b>: réplicas vs máximo de KEDA, cola y batch de Triton, GPU, cold starts.',
            '<b>Modelo</b>: distribuciones de predicción y confianza, drift por slice, todo partido por <code>model_version</code>.',
          ] },
          { t: 'h3', text: 'Métricas que salen de jobs batch' },
          { t: 'p', html: `El PSI del día o la tasa de correcciones de 4 semanas no salen de un servicio con <code>/metrics</code>: los calcula un job que corre y termina. Tres formas de llevarlos a Prometheus:` },
          { t: 'table', head: ['Opción', 'Cómo', 'Cuidado'], rows: [
            ['Pushgateway', 'El job empuja sus resultados al terminar', 'Prometheus la recomienda solo para el resultado de un batch a nivel de servicio, que es exactamente este caso. Pero nunca olvida una serie: si el job deja de correr, el último PSI queda publicado para siempre'],
            ['Tabla + Grafana', 'El job escribe en una tabla (Postgres, el warehouse) y Grafana la consulta', 'Las alertas se evalúan en Grafana, no en Prometheus: dos lugares con reglas'],
            ['Métrica de un servicio largo', 'Un servicio lee el último resultado y lo expone como gauge', 'Una pieza más que operar'],
          ] },
          { t: 'callout', kind: 'trap', title: 'Trampa: el job que dejó de correr', html: `<p>Con Pushgateway, si el job de drift falla desde el martes, Prometheus sigue viendo el PSI del lunes, 0.05, y todo parece estable. Hace falta una alerta de frescura. El Pushgateway ya agrega a cada grupo <code>push_time_seconds</code> (la hora del último push exitoso), así que basta con <code>time() - push_time_seconds{job="stain-psi"} &gt; 26 * 3600</code> (26 h para un job diario, con margen; el scrape del Pushgateway va con <code>honor_labels: true</code> para que el label <code>job</code> sea el del job y no el del scrape). Si quieres que la alerta signifique "el cálculo terminó bien" y no solo "algo se empujó", el job publica además su propio gauge de último éxito. Un monitor que no se monitorea a sí mismo falla en silencio igual que el modelo.</p>` },
          { t: 'callout', kind: 'skip', html: `<p>No hace falta saber escribir PromQL de memoria en la entrevista. Hace falta decir "histogram, not averages", "alert on symptoms", el umbral, la ventana, la severidad y a quién le llega. Si mencionas burn rate con el 14.4×, suma; si no, no pierdes el caso.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"Prometheus scrapes every pod; latency is a histogram so I can aggregate across pods and take the p99. Alerts come from the SLO: at 99.9% over thirty days, I page when we burn the budget fourteen times too fast over both one hour and five minutes. Model-quality alerts open tickets. The drift job pushes its results, and I alert when its last push time gets stale, so a dead job is also an alert."</p>` },
        ],
      },

      // ======================================================== 7
      {
        id: 'logging-predicciones',
        title: 'Logging de predicciones: la materia prima del monitoreo y del etiquetado',
        titleEn: 'Prediction logging',
        priority: 'core',
        dims: ['monitoreo', 'estimaciones', 'arquitectura'],
        blocks: [
          { t: 'p', html: `Las métricas de Prometheus son agregados: te dicen que la tasa de baja confianza subió, no cuáles fueron las imágenes. Para investigar, calcular drift por slice, unir con labels y elegir qué etiquetar, necesitas <b>una fila por predicción</b>. Sin logs de predicción no hay monitoreo de modelo, ni active learning, ni forma de responder "¿qué vio el modelo ese día?".` },
          { t: 'h3', text: 'Qué va en cada fila' },
          { t: 'table', head: ['Campo', 'Por qué', 'c01', 'c04'], rows: [
            ['id de la predicción', 'Unir con labels, trazas y quejas', '<code>request_id</code> (el mismo en logs y trazas)', '<code>slide_id</code> + sha256 del archivo'],
            ['model_version (+ config)', 'Saber qué modelo produjo qué; comparar canary vs estable', '<code>model_version</code>', 'model_version, digest del contenedor, hash de la config de preprocesamiento'],
            ['Referencia al input', 'Reproducir y etiquetar sin copiar datos sensibles', 'Prefijo del sha256 de la imagen, bytes, resolución', 'Clave del objeto en el archivo, lab, escáner, mpp'],
            ['Resumen del input', 'Drift sin volver a leer el input', 'Brillo medio, formato', 'Histograma de color del tejido, % de tiles borrosos, área de tejido'],
            ['Salida', 'Distribución de predicciones y join con labels', 'Top-k ids y scores', 'Tumor mm², % de tejido, confianza, QC flags (los polígonos viven en <code>results/</code>)'],
            ['Tiempos', 'Latencia por tramo, turnaround', 'Latencia por tramo', 'Espera en cola, descarga, inferencia, escritura'],
            ['Contexto', 'Slices', 'source (mobile/web/internal)', 'Tipo de espécimen'],
          ] },
          { t: 'p', html: `En c01 esa fila es una línea JSON de ${E('≈ 300 bytes')} a stdout, que Fluent Bit lleva a S3 y se convierte a Parquet (<a href="#c01.monitoreo">c01</a>). El servicio nunca espera al log: si el pipeline de logs falla, se pierden filas (y se alerta), pero el request no se cae.` },
          { t: 'h3', text: 'Almacenamiento y costo' },
          { t: 'calc', title: 'Cuánto cuesta loguear todo en c01', rows: [
            { label: 'Volumen crudo', expr: '10 M requests/día × ≈ 300 B', value: '≈ 3 GB/día' },
            { label: 'Retención de 90 días', expr: '3 GB × 90', value: '≈ 270 GB' },
            { label: 'Costo en S3 Standard', expr: '270 GB × ' + E('≈ US$0.023/GB-mes'), value: E('≈ US$6/mes'), note: 'precio de us-east-1; verifica. En Parquet ocupa varias veces menos' },
            { label: 'Si logueas la imagen completa', expr: '10 M × ≈ 200 KB', value: '≈ 2 TB/día = 60 TB/mes' },
            { label: 'Costo de las imágenes', expr: '60,000 GB × ' + E('US$0.023'), value: E('≈ US$1,380 más cada mes'), note: 'acumulativo: el segundo mes ya son US$2,760' },
          ], result: 'Las filas de predicción son casi gratis: se loguea el 100 %. Las imágenes no: además de costar la mitad del presupuesto de c01 al mes y creciendo, son datos personales. Se guardan referencias, y solo se copian las ≈ 5k/mes que van a etiquetado o al golden set.' },
          { t: 'p', html: `Formato: Parquet, particionado por fecha y <code>model_version</code> (y en c04 por lab), para que el job de drift lea solo la partición del día y una consulta en Athena, Spark o DuckDB no escanee meses. Retención escalonada: filas crudas 30–90 días, agregados diarios indefinidamente, lo que entra a un dataset con la retención de ese dataset.` },
          { t: 'h3', text: 'Muestreo: todo, una muestra o los interesantes' },
          { t: 'calc', title: 'c04: embeddings por tile, todos o una muestra', rows: [
            { label: 'Estadísticas de color por tile', expr: '3.6 M tiles/día × ≈ 32 B', value: '≈ 115 MB/día', note: 'mejor aún: un histograma agregado por slide' },
            { label: 'Embedding de 512 dimensiones en FP16 por tile', expr: '3.6 M × 512 × 2 B', value: '≈ 3.7 GB/día' },
            { label: 'Muestra de 50 tiles por slide', expr: '1,200 × 50 × 1 KB', value: '≈ 61 MB/día' },
          ], result: 'Para detectar drift de contenido, 60,000 embeddings al día sobran (el MMD o el domain classifier trabajan con miles). Guardar todos multiplica por 60 el volumen sin mejorar la detección.' },
          { t: 'p', html: `Tres políticas que se combinan: <b>100 %</b> de las filas livianas (metadatos, salida, tiempos); <b>muestra aleatoria</b> de lo pesado (embeddings, inputs), para estadísticas sin sesgo; y <b>100 % de lo interesante</b> (baja confianza, desacuerdos en shadow, QC flags, correcciones mayores), que es lo que alimenta el etiquetado.` },
          { t: 'h3', text: 'Privacidad' },
          { t: 'list', items: [
            '<b>Minimización</b>: guarda lo que usas para monitorear y etiquetar. c01 no guarda la imagen, ni el EXIF, ni ids de usuario en claro.',
            '<b>Datos de salud</b> (c04): el WSI trae una imagen de la etiqueta del portaobjetos y una macro que pueden mostrar nombre o código del paciente, más metadatos. Los logs llevan ids seudonimizados; ninguna copia para etiquetado o entrenamiento conserva esas imágenes. Qué exige la ley (LFPDPPP en México, HIPAA en EE. UU.) lo decide legal; tú diseñas para el mínimo necesario y el acceso auditado.',
            '<b>Acceso</b>: los logs de predicción son datos de producción; mismo control de acceso y el mismo registro de auditoría que el resto.',
          ] },
          { t: 'callout', kind: 'connect', html: `<p>Los logs de predicción son también la <b>fuente del etiquetado</b>: de ahí salen las muestras aleatorias, las de baja confianza y los desacuerdos que van a revisión humana, y el active learning de c04 con su presupuesto de horas de patólogo (<a href="#m09.etiquetado">M9</a>). En shadow, las dos respuestas pareadas por request_id (<a href="#m11.shadow">M11</a>).</p>` },
          { t: 'callout', kind: 'trap', title: 'Trampa: loguear la imagen "por si acaso"', html: `<p>Parece prudente y es lo contrario: un bucket que crece 60 TB al mes, lleno de datos personales, sin dueño ni retención, que nadie va a etiquetar. Guarda referencias al almacenamiento donde el input ya vive (el producto en c01, el archivo digital en c04) y copia solo lo seleccionado, sin metadatos sensibles y con lifecycle.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"Every prediction writes one small row: the slide ID and file hash, model version and preprocessing config, a summary of the input, the outputs and the timings. That's cheap enough to keep at a hundred percent. Heavy things, like tile embeddings, are sampled, and I never log raw images: I keep references to the archive, where the slide already lives."</p>` },
        ],
      },

      // ======================================================== 8
      {
        id: 'reentrenar',
        title: 'Cuándo reentrenar (y cuándo no)',
        titleEn: 'When to retrain',
        priority: 'core',
        dims: ['monitoreo', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `El lado del pipeline (calendario vs disparadores vs continuo, cómo elegir la cadencia con números, el gate) está en <a href="#m10.reentrenamiento">M10</a>. Aquí va el lado del monitoreo: cuando una señal se mueve, ¿reentrenar es la respuesta?` },
          { t: 'p', html: `Casi siempre, la respuesta es "todavía no": primero diagnosticas. La mitad de las "degradaciones del modelo" son un cliente que cambió, un escáner reconfigurado, un paso del pipeline roto o un deploy tuyo. Reentrenar sobre eso, en el mejor caso, gasta GPU y horas de patólogo; en el peor, le enseña al modelo el bug.` },
          { t: 'table', caption: 'De la señal a la acción', head: ['Lo que ves', 'Diagnóstico probable', 'Qué haces', '¿Reentrenar?'], rows: [
            ['La métrica cambió justo después de un deploy tuyo', 'Bug o skew de la versión nueva', 'Rollback (<a href="#m11.rollback">M11</a>) y comparar ambos caminos', 'No'],
            ['Input raro en un solo origen: mpp faltante, archivos corruptos, perfil de color borrado', 'Datos upstream rotos', 'QC que marca y no procesa (c04 no procesa un slide sin mpp confiable); avisar al dueño del origen', 'No'],
            ['Drift de entrada alto, labels estables', 'Cambio benigno (el modelo generaliza)', 'Etiquetar una muestra para confirmar; anotar y seguir', 'No, por ahora'],
            ['Drift de entrada y labels peores en el mismo slice', 'Data drift dañino', 'Etiquetar ese slice (active learning, lab C primero en c04) y reentrenar o afinar', 'Sí'],
            ['Labels peores en todos los slices, inputs estables', 'Concept drift o cambio de proceso (guía, UI, anotadores)', 'Hablar con los expertos del dominio; reetiquetar con la regla nueva', 'Sí, con labels nuevos'],
            ['Dominio nuevo conocido de antemano (lab o escáner nuevo)', 'Drift anunciado', 'No esperes a que dispare: modo silencioso y labels del dominio nuevo antes de habilitarlo', 'Sí, planeado'],
            ['Nada raro', '—', 'Reentrenamiento por calendario', 'Mensual en c01–c04'],
          ] },
          { t: 'p', html: `Para c04 la política concreta es: <b>mensual</b> con las correcciones nuevas y los labels de active learning, o <b>disparado</b> por drift confirmado o por un lab o escáner nuevo. Un lab nuevo no espera a que el PSI dispare: antes de habilitarlo pasa por modo silencioso (el modelo corre, los resultados no se muestran) y se anotan al menos 30 slides suyos, igual que el lab C antes de habilitarlo. El gate es el mismo de siempre: ningún slice peor que producción por más de su intervalo de confianza (por ejemplo, Dice −0.02) y la sensibilidad por lesión cumplida en el golden set (<a href="#c04.monitoreo">c04</a>).` },
          { t: 'callout', kind: 'why', title: 'Un disparador abre un ticket, no un deploy', html: `<p>El monitoreo detecta; la validación decide. Un disparador adelanta la corrida del pipeline y le avisa a una persona; el candidato pasa por el mismo gate, shadow o modo silencioso y canary que cualquier otro. Un reentrenamiento que llega solo a producción convierte un bug de datos en un incidente en horas, sin que nadie lo revise. Es la misma regla de <a href="#m10.reentrenamiento">M10</a>, vista desde el lado de quien recibe la alerta.</p>` },
          { t: 'callout', kind: 'trap', title: 'Trampa: reentrenar con los labels del propio modelo', html: `<p>En c04, las correcciones del patólogo parten de la propuesta del modelo. Si el modelo sistemáticamente se queda corto en un borde y el patólogo corrige "lo suficiente", los labels nuevos heredan parte del sesgo, y el modelo reentrenado lo confirma. En c01, entrenar con "la categoría que eligió el vendedor" enseña a imitar las sugerencias. Por eso la auditoría independiente de c04, el holdout sin sugerencias de c01 y la muestra aleatoria en el etiquetado no son lujos: son lo que evita que el feedback loop se cierre sobre sí mismo.</p>` },
          { t: 'callout', kind: 'senior', html: `<p>Frase que suma: "Before retraining I rule out three things: my own deploy, broken upstream data, and training-serving skew. Retraining only fixes a world that changed, and only if I have labels from that new world." Y otra: "Known domain changes, like a new scanner, don't wait for a drift alert; they go through silent mode with their own labels."</p>` },
          { t: 'callout', kind: 'connect', html: `<p>Cómo llega el modelo reentrenado a producción: <a href="#m11">M11</a> (shadow, canary, rollback). Qué etiquetar con un presupuesto de horas caras: <a href="#m09.etiquetado">M9</a> y el active learning de <a href="#c04">c04</a>.</p>` },
        ],
      },

      // ======================================================== 9
      {
        id: 'runbooks',
        title: 'Dashboards, runbooks y on-call',
        titleEn: 'Dashboards, runbooks and on-call',
        priority: 'core',
        dims: ['monitoreo', 'comunicacion'],
        blocks: [
          { t: 'p', html: `Una alerta sin alguien que sepa qué hacer es ruido con sonido. La prueba de un sistema de monitoreo no es cuántas métricas tiene, sino qué pasa a las 3 a. m. cuando una dispara: quién la recibe, qué mira primero y qué puede hacer.` },
          { t: 'h3', text: 'Dashboards por audiencia' },
          { t: 'table', head: ['Audiencia', 'Pregunta', 'Qué ve (c04)'], rows: [
            ['On-call', '¿Está roto? ¿Qué parte?', 'Edad del mensaje más viejo, DLQ, turnaround vs SLO, errores del worker, réplicas vs máximo de KEDA, marcadores de deploy'],
            ['Equipo de ML', '¿El modelo sigue bien? ¿Dónde no?', 'PSI de color y % de tiles borrosos por lab y escáner, % de tumor predicho por lab, confianza, tasa de major edits por slice y por <code>model_version</code>'],
            ['Laboratorio / negocio', '¿El sistema ayuda?', '% de slides con resultado de IA a tiempo, tiempo de revisión por slide, tasa de correcciones mayores por mes'],
          ] },
          { t: 'p', html: `Un dashboard que intenta servir a los tres no sirve a ninguno: el on-call no necesita el PSI a las 3 a. m. y el patólogo jefe no necesita el batch de Triton.` },
          { t: 'h3', text: 'Anatomía de una alerta' },
          { t: 'kv', items: [
            ['Nombre', '<code>ClassifierHighP99Latency</code>', 'dice qué síntoma, no qué causa'],
            ['Condición y ventana', 'p99 &gt; 200 ms durante 10 min', 'sale del SLO'],
            ['Severidad', 'page', 'decide el canal'],
            ['Dueño', 'on-call del servicio', 'una persona o rotación, nunca "el equipo"'],
            ['Runbook', '<code>runbook_url</code> en la anotación', 'qué mirar primero, cómo mitigar, cuándo escalar'],
            ['Acción', 'escalar, rollback, modo silencioso', 'si no hay ninguna acción posible, no es un page'],
          ] },
          { t: 'h3', text: 'Un runbook completo: drift de tinción en c04' },
          { t: 'p', html: `La alerta es <code>StainDriftPerScanner</code> de <a href="#c04.monitoreo">c04</a>: PSI del histograma de color de tejido del escáner Y (lab C, habilitado hace meses) &gt; 0.2 contra la referencia de entrenamiento del modelo actual (A, B y C). Severidad ticket; dueños, el equipo de ML y el responsable del laboratorio, en horario. Los pasos, en orden:` },
          { t: 'steps', items: [
            { title: 'Acotar', meta: '10 min', html: '¿Un escáner, un lab o todos? ¿Desde cuándo: salto de un día o subida gradual? ¿Coincide con un deploy nuestro (modelo, preprocesamiento, versión del lector de slides)? Si coincide con un deploy, es sospecha de skew: comparar con slides de referencia por los dos caminos y, si difieren, rollback.' },
            { title: 'Mirar la fuente', meta: '30 min', html: 'Preguntar al lab C: ¿actualización de firmware o de perfil de color del escáner, lote nuevo de reactivo, cambio de protocolo de tinción? Revisar si cambiaron los metadatos del DICOM (perfil de color, mpp). Revisar el % de tiles borrosos y el área de tejido: si también se movieron, puede ser el escáner en general, no la tinción.' },
            { title: 'Mirar ejemplos', meta: '30 min', html: 'Miniaturas de 10 slides de hoy contra 10 de la referencia, con el overlay del modelo. Un humano ve en minutos lo que el PSI no explica: ¿más rosado, más pálido, desenfocado?' },
            { title: 'Medir el impacto', meta: 'horas a días', html: 'Distribución del % de tumor predicho y de la confianza en esos slides; tasa de major edits del lab C desde el cambio (pocos días: ruidosa). Si hace falta evidencia rápida, pedir a un patólogo que revise ≈ 10 slides con la propuesta oculta: ' + E('≈ 1–2 h de patólogo') + ', del presupuesto de etiquetado.' },
            { title: 'Decidir', html: 'Benigno (el modelo rinde igual): cerrar con nota; no mover la referencia de entrenamiento, pero sí sumar este período a la referencia reciente. Dañino: pasar ese laboratorio (o ese escáner) a modo silencioso: el modelo sigue corriendo y se loguea, pero el viewer muestra "sin resultado de IA" y el patólogo trabaja como antes, porque el sistema es asistivo. Y abrir el reentrenamiento con labels del lab C seleccionados por active learning. Un cambio de preprocesamiento (normalizar color) también es un modelo nuevo: pasa por el gate y el modo silencioso.' },
            { title: 'Cerrar el ciclo', html: 'Actualizar el runbook con lo aprendido; si fue falsa alarma, revisar el umbral con la historia de semanas normales; pedir al lab que avise antes de reconfigurar un escáner (un cambio conocido no debería llegar por una alerta).' },
          ] },
          { t: 'callout', kind: 'why', title: 'Por qué el modo silencioso es una buena mitigación en c04', html: `<p>En c04 la disponibilidad no es crítica pero la integridad sí: un contorno equivocado mostrado con confianza puede anclar al patólogo. Como el sistema es de apoyo a la decisión y el patólogo firma siempre, ocultar los resultados de un laboratorio vuelve al proceso de antes, no a un servicio caído, y el modelo sigue produciendo resultados que puedes evaluar en silencio. Diseñar ese <b>interruptor por slice</b> (por lab o escáner) convierte "no sé si el modelo está bien aquí" en una decisión segura y reversible.</p>` },
          { t: 'p', html: `El runbook de un page de c01 es más corto y más urgente: ante <code>ClassifierHighP99Latency</code>, (1) ¿qué tramo subió: preprocesamiento, cola de Triton o cómputo?; (2) ¿hubo deploy? → rollback si coincide; (3) ¿KEDA está en su máximo (4)? → falta capacidad de GPU, subir el máximo si hay cuota; (4) ¿un solo caller manda de más? → rate limiting por caller; (5) escalar si en 30 min no mejora. Mitigar primero, entender después.` },
          { t: 'h3', text: 'Fatiga de alertas' },
          { t: 'list', items: [
            '<b>Mide</b> qué fracción de pages terminó en una acción. Si la mitad se cierran con "no era nada", el on-call aprende a ignorarlas, y un día ignora la real.',
            '<b>Borra o degrada</b> alertas que nadie actuó en un mes: pasan a dashboard o a ticket.',
            '<b>Sostén y agrupa</b>: <code>for</code>, ventanas de burn rate, un mínimo de muestras, y Alertmanager agrupando por incidente.',
            '<b>Separa rotaciones</b>: el on-call de infraestructura recibe pages de servicio; el equipo de ML recibe tickets de calidad en horario. Un científico de datos despertado por un PSI no arregla nada a las 3 a. m.',
          ] },
          { t: 'h3', text: 'Postmortems' },
          { t: 'p', html: `Después de cada incidente con impacto, un postmortem <b>sin culpables</b> (blameless): línea de tiempo, impacto (en c04: cuántos slides con resultado dudoso y si alguno llegó a firmarse), cuánto tardó en detectarse y con qué señal, qué la habría detectado antes y acciones con dueño y fecha. En ML, la pregunta clave es la de detección: si el incidente lo encontró un usuario, falta una métrica; si lo encontró una alerta tres semanas tarde, falta una señal más rápida.` },
          { t: 'h3', text: 'Preguntas de seguimiento típicas' },
          { t: 'followups', items: [
            { q: '¿Cómo sabes que el modelo sigue funcionando si los labels tardan semanas?',
              junior: 'Espero a que lleguen los labels y calculo la accuracy cada mes.',
              senior: 'Mientras no hay labels, vigilo proxies que dicen "algo cambió": estadísticas de entrada por escáner, distribución de predicciones y de confianza, con referencia y umbral. Los labels demorados (correcciones del patólogo) confirman si empeoró, por slice y en ventanas de 4 semanas por el ruido. Y una auditoría independiente mide el sesgo de esos labels.',
              why: 'Distingue "cambió" de "empeoró", nombra el retraso y el sesgo de los labels y da ventanas justificadas.' },
            { q: 'El PSI de un feature subió a 0.3. ¿Reentrenas?',
              junior: 'Sí, hay drift, así que reentreno con datos nuevos.',
              senior: 'Primero descarto un deploy mío y datos rotos upstream, y miro ejemplos. Después mido impacto con labels en ese slice. Si el modelo rinde igual, es drift benigno y anoto. Si empeoró, etiqueto ese slice y reentreno; el candidato pasa por el gate y el rollout normal. El PSI abre la investigación; no decide.',
              why: 'Drift no implica peor accuracy, y reentrenar sobre un bug lo empeora.' },
            { q: '¿Por qué no usas un test KS con p &lt; 0.05 para alertar de drift?',
              junior: 'Es el test estándar para comparar distribuciones, así que me parece bien.',
              senior: 'Con millones de tiles por día, cualquier diferencia minúscula da p ≈ 0. Alerto sobre tamaño de efecto (D, PSI o una distancia) con umbrales calibrados en semanas normales, exijo que se sostenga y agrupo por escáner para no multiplicar las pruebas.',
              why: 'Entiende que el p-value mide n y que muchos tests dan falsas alarmas.' },
            { q: '¿Qué alertas despiertan a alguien en este sistema batch?',
              junior: 'Todas las importantes: drift, errores, la cola, la GPU.',
              senior: 'Solo lo que afecta al usuario ahora y alguien puede arreglar ahora. En c04, la cola atrasada hace page solo de 07:00 a 22:00, cuando un patólogo puede abrir un caso sin resultado; de noche es ticket, porque sobra tiempo para cumplir antes de las 07:00, y una alerta a las 05:30 que sí hace page si quedan slides escaneados antes de las 22:00 sin resultado: el tiempo sobra solo si alguien se entera a tiempo. La DLQ, el drift y la calidad son tickets: la respuesta segura (modo silencioso) no necesita despertar a nadie.',
              why: 'La severidad sale del impacto y del SLO, no de lo "importante" que suena la métrica.' },
            { q: '¿Cómo alertas sobre la latencia de un sistema asíncrono?',
              junior: 'Con la cantidad de mensajes en la cola: si pasa de 100, alerta.',
              senior: 'Con la edad del mensaje más viejo, que es lo que castiga el SLO de turnaround: en c04, más de 30 min sostenido 10 min, que deja ≈ 20 min para salvar los 60. La profundidad la uso para escalar con KEDA. Y una alerta aparte para la DLQ, porque un mensaje venenoso deja de contar en la edad.',
              why: 'Conecta la métrica con el SLO y conoce el punto ciego de la métrica de SQS.' },
            { q: 'Tu job diario de drift publica un PSI de 0.05 todos los días. ¿Todo bien?',
              junior: 'Sí, está debajo de 0.1: estable.',
              senior: 'Depende de si el job corrió. Con Pushgateway, el último valor queda para siempre aunque el job muera; por eso alerto si la hora del último push (<code>push_time_seconds</code>, que el Pushgateway agrega solo) tiene más de un día.',
              why: 'Un monitor que no se monitorea falla en silencio.' },
          ] },
          { t: 'callout', kind: 'interview', html: `<p>"Every alert has an owner, a runbook and an action. Pages are for user-facing symptoms; drift opens a ticket for the ML team during working hours. For a stain drift on one scanner, the runbook checks our own deploys first, then the lab, then samples, then impact with labels, and the safe mitigation is to turn off AI results for that scanner, because pathologists can always work without them."</p>` },
        ],
      },

      // ======================================================== 10
      {
        id: 'autoevaluacion',
        title: 'Autoevaluación',
        titleEn: 'Self-check',
        priority: 'core',
        dims: ['monitoreo'],
        blocks: [
          { t: 'quiz', items: [
            { q: 'El dashboard de servicio de c04 está verde (cola vacía, cero errores, SLO cumplido), pero los patólogos del lab C (habilitado hace meses) corrigen más. ¿Qué tipo de falla es y qué señal la habría visto primero?',
              options: ['Una falla de infraestructura: la veía el uso de GPU', 'Una falla silenciosa del modelo: la veía el drift de entrada por escáner (color de tinción) antes que los labels', 'Un problema de latencia: la veía el p99', 'Ninguna: si el servicio está verde, el modelo está bien'],
              answer: 1,
              explain: 'El servicio responde bien y el modelo empeora. La estadística de color por escáner se mueve en un día; la tasa de correcciones tarda semanas en ser concluyente.' },
            { q: 'Referencia 10/20/40/20/10 % y actual 4/12/34/30/20 % en 5 bins. ¿PSI aproximado?',
              options: ['≈ 0.02', '≈ 0.08', '≈ 0.22', '≈ 1.2'],
              answer: 2,
              explain: 'Aportes 0.055 + 0.041 + 0.010 + 0.041 + 0.069 ≈ 0.215: por encima del 0.2 que usan c01 y c04 como umbral de acción.' },
            { q: 'Comparas un millón de valores de hoy contra un millón de la referencia con un test KS y obtienes p ≈ 10⁻²⁹. ¿Qué concluyes?',
              options: ['Hay un drift grave: reentrenar', 'El test está mal implementado', 'Que hay que bajar α a 0.01', 'Nada todavía: con n tan grande casi cualquier diferencia es significativa; miras el tamaño del efecto (D, PSI)'],
              answer: 3,
              explain: 'En el ejemplo, D ≈ 0.008 (una corrida de 0.02 σ). El p-value mide evidencia de que hay diferencia, no cuánto importa.' },
            { q: 'Las correcciones mayores suben a la vez en los tres labs de c04 y ninguna estadística de entrada se movió. ¿Qué sospechas primero?',
              options: ['Concept drift o un cambio de proceso: guía de anotación, UI del viewer, patólogos nuevos', 'Data drift en el lab C', 'Un problema de GPU', 'Label shift por temporada'],
              answer: 0,
              explain: 'Inputs estables con labels peores en todos lados apuntan a que cambió qué se considera correcto, o cómo se corrige. El drift de un escáner se vería solo en su lab.' },
            { q: 'SLO de 99.9 % a 30 días. ¿Qué tasa de errores sostenida durante 1 h (y 5 min) dispara el page rápido del SRE Workbook, y cuánto presupuesto consume esa hora?',
              options: ['0.1 % y 0.1 %', '1.44 % y 2 % del presupuesto mensual', '14.4 % y 14.4 %', '6 % y 5 %'],
              answer: 1,
              explain: 'Burn rate 14.4 × 0.1 % = 1.44 %; en 1 h de 720 consume 14.4 / 720 = 2 %.' },
            { q: 'En la cola estándar de SQS de c04, un slide corrupto tumba al worker en cada intento. ¿Qué alerta lo atrapa?',
              options: ['La edad del mensaje más viejo &gt; 30 min, siempre', 'La utilización de GPU', 'La DLQ &gt; 0: tras 3 recepciones el mensaje deja de contar en la edad, y termina en la DLQ', 'Ninguna: SQS lo reintenta para siempre'],
              answer: 2,
              explain: 'SQS excluye de ApproximateAgeOfOldestMessage los mensajes recibidos 3 o más veces sin borrarse; la redrive policy los manda a la DLQ.' },
            { q: 'Alguien propone agregar slide_id como label del histograma de duración por slide para "poder buscar un slide lento". ¿Qué respondes?',
              options: ['Bien: más labels, más detalle', 'No: crea series sin límite (≈ 500k al mes); el slide_id va en logs o exemplars', 'Solo si el histograma tiene pocos buckets', 'Bien, si se borra cada mes'],
              answer: 1,
              explain: '14 series por histograma × 36,000 slides al mes ≈ 504,000 series. Los ids van a los logs, que cuestan bytes, no series en memoria.' },
            { q: 'El job diario de drift de c04 publica sus resultados en Pushgateway. El martes deja de correr por un permiso vencido. ¿Qué ves en Prometheus?',
              options: ['La serie desaparece y la alerta de drift dispara', 'Un error de scrape', 'Un PSI de 0', 'El último PSI publicado, para siempre: parece estable. Hace falta alertar sobre la hora de la última corrida exitosa'],
              answer: 3,
              explain: 'Pushgateway nunca olvida una serie. Por eso hace falta una regla de frescura (en c04, <code>StainPsiJobStale</code>) sobre <code>push_time_seconds</code>, que el Pushgateway agrega a cada grupo: el último push no puede tener más de ≈ 26 h.' },
            { q: '¿Cuál de estas NO es una razón para reentrenar?',
              options: ['Drift en el lab C con más correcciones mayores en ese lab', 'Un lab nuevo que se va a integrar el mes que viene', 'La tasa de errores subió justo después del deploy de un preprocesamiento nuevo', 'La guía de anotación cambió y los labels nuevos siguen la regla nueva'],
              answer: 2,
              explain: 'Un cambio justo después de tu deploy es un bug o skew: rollback y comparar caminos. Reentrenar no arregla tu código.' },
          ] },
          { t: 'checklist', id: 'antes-de-ir-a-produccion', items: [
            { id: 'capas', html: 'Métricas en las cinco capas: infraestructura, servicio, datos, modelo y negocio, con qué tan rápido llega cada una.' },
            { id: 'histogramas', html: 'Latencia (o turnaround) como histograma con buckets alrededor del SLO, desglosada por tramo; en batch, edad del mensaje más viejo y alerta de DLQ.' },
            { id: 'version', html: 'Toda métrica y todo log de predicción llevan <code>model_version</code> (y los slices: lab, escáner, source); ningún label con valores sin límite.' },
            { id: 'proxies', html: 'Proxies sin labels definidos: qué distribución, contra qué referencia (entrenamiento y reciente), con qué medida y umbral.' },
            { id: 'labels', html: 'Labels demorados con su retraso, su sesgo y el id que permite unirlos; una muestra independiente del modelo para medir ese sesgo.' },
            { id: 'slices', html: 'Métricas de modelo por slice con un mínimo de muestras y ventanas justificadas por el intervalo de confianza.' },
            { id: 'efecto', html: 'Drift alertado por tamaño de efecto (PSI, D, distancia), sostenido en el tiempo y agrupado, no por p-values sueltos.' },
            { id: 'slo', html: 'Alertas de servicio derivadas del SLO (burn rate o umbral con ventana), con protección contra tráfico bajo.' },
            { id: 'severidad', html: 'Cada alerta con severidad (page / warning / ticket), dueño, runbook_url y una acción posible.' },
            { id: 'logs', html: 'Log de predicción de cada request o slide, asíncrono, sin imágenes ni PII; lo pesado muestreado; retención definida.' },
            { id: 'meta', html: 'Los jobs de monitoreo se monitorean: hora de la última corrida exitosa con alerta si es vieja.' },
            { id: 'reentreno', html: 'Política de reentrenamiento: calendario + disparadores que abren ticket; diagnóstico (deploy, upstream, skew) antes de reentrenar; nunca deploy automático.' },
          ] },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'm12-01', kind: 'concepto', q: '¿Qué es una falla silenciosa en ML?',
        a: 'El servicio responde bien (200 OK, latencia normal, sin errores) mientras las predicciones empeoran, casi siempre porque cambió el mundo que alimenta al modelo. Solo la ven las métricas de datos, de modelo y de negocio.' },
      { id: 'm12-02', kind: 'concepto', q: 'Las cinco capas del monitoreo, de la más rápida a la más lenta.',
        a: 'Infraestructura (segundos), servicio (minutos), datos (minutos a horas), modelo (horas con proxies, semanas con labels), negocio (días a semanas). La señal más confiable es la más lenta.' },
      { id: 'm12-03', kind: 'tradeoff', q: 'Golden signals vs RED vs USE.',
        a: 'Golden signals: latencia, tráfico, errores, saturación (SRE de Google). RED: rate, errors, duration, por servicio. USE: utilization, saturation, errors, por recurso. RED por servicio y USE por recurso.' },
      { id: 'm12-04', kind: 'trampa', q: '"La GPU está al 100 %, necesitamos más GPUs."',
        a: 'GPU utilization es la fracción del tiempo con algún kernel corriendo; un kernel chico cuenta igual que uno que llena la GPU. Decide con la cola (tiempo en cola de Triton), el batch promedio y SM activity.' },
      { id: 'm12-05', kind: 'concepto', q: '¿Qué métrica de latencia usas en un sistema batch con cola?',
        a: 'La edad del mensaje más viejo (en SQS, ApproximateAgeOfOldestMessage) y el turnaround por ítem. La profundidad sirve para escalar; la edad es lo que castiga el SLO.' },
      { id: 'm12-06', kind: 'trampa', q: 'Un mensaje venenoso en una cola estándar de SQS, ¿hace sonar la alerta de edad?',
        a: 'No: tras 3 recepciones sin borrarse, SQS lo manda al final y deja de contarlo en ApproximateAgeOfOldestMessage. Por eso la DLQ tiene su propia alerta (c04: DLQ &gt; 0) y más retención que la cola original.' },
      { id: 'm12-07', kind: 'numero', q: 'Cardinalidad: histograma de 11 buckets con slide_id como label en c04.',
        a: '14 series (11 + "+Inf" + _sum + _count) × 36,000 slides/mes ≈ 504,000 series al mes. Los ids van a logs o exemplars, nunca a labels.' },
      { id: 'm12-08', kind: 'concepto', q: 'Proxy vs label en c04.',
        a: 'Proxies en horas: color de tinción por escáner, % de tumor predicho, confianza. Label: tasa de correcciones mayores (&gt; 20 % del área) al firmar, horas a días, sesgada por automation bias; auditoría mensual independiente para medir ese sesgo.' },
      { id: 'm12-09', kind: 'trampa', q: '"Monitoreo la accuracy con los labels que confirman los usuarios."',
        a: 'Casi todo label de producción está filtrado por el modelo: c03 solo revisa rechazados (ves precisión, no recall), c01 acepta sugerencias que el modelo mostró, c04 corrige propuestas. Necesitas una muestra que no dependa del modelo.' },
      { id: 'm12-10', kind: 'numero', q: 'Intervalo al 95 % de una tasa de 10 % con 11,200 vs 2,800 muestras.',
        a: '± 0.56 pp con ≈ 11,200 (4 semanas de un lab en c04) y ± 1.1 pp con ≈ 2,800 (1 semana). Por eso la tasa de correcciones se mira en ventanas de 4 semanas.' },
      { id: 'm12-11', kind: 'tradeoff', q: 'Data drift vs concept drift vs label shift.',
        a: 'Data drift: cambia p(x) (escáner nuevo); se ve en inputs. Concept drift: cambia p(y|x) (guía nueva); solo se ve con labels. Label shift: cambia p(y) (mezcla estacional); se ve en la distribución de predicciones.' },
      { id: 'm12-12', kind: 'trampa', q: 'La accuracy cayó desde el día del deploy. ¿Drift?',
        a: 'Probablemente training-serving skew o un bug: tu pipeline calcula distinto, el mundo no cambió. Se comprueba pasando ejemplos de referencia por los dos caminos. Reentrenar no lo arregla.' },
      { id: 'm12-13', kind: 'concepto', q: '¿Drift implica que el modelo empeoró?',
        a: 'No. Fotos mejor iluminadas suben el PSI y quizá mejoran la accuracy; un concept drift puro deja el PSI en 0 y la accuracy cae. El drift abre una investigación; los labels deciden.' },
      { id: 'm12-14', kind: 'numero', q: 'PSI de 10/20/40/20/10 % → 4/12/34/30/20 %.',
        a: 'Σ (a − r) × ln(a / r) = 0.055 + 0.041 + 0.010 + 0.041 + 0.069 ≈ 0.215. Para una normal con la media corrida δ σ, PSI ≈ δ²: 0.1 ≈ 0.3 σ, 0.25 ≈ 0.5 σ.' },
      { id: 'm12-15', kind: 'concepto', q: 'Umbrales del PSI.',
        a: 'Convención de credit scoring: &lt; 0.1 estable, 0.1–0.25 moderado, &gt; 0.25 grande (otras fuentes, c01 y los archivos de c04 cortan en 0.2). c01 y c04 actúan desde 0.2. Calíbralo con la variación entre semanas normales; depende de bins y n.' },
      { id: 'm12-16', kind: 'trampa', q: 'Test KS con un millón de muestras por lado: p ≈ 10⁻²⁹.',
        a: 'Con n enorme todo es significativo (el ejemplo es una corrida de 0.02 σ, D ≈ 0.008). Alerta por tamaño de efecto calibrado. Evidently pasa de KS a Wasserstein por encima de 1,000 muestras.' },
      { id: 'm12-17', kind: 'concepto', q: 'Tres formas de detectar drift en embeddings.',
        a: 'Distancia entre medias (simple, solo corridas de media), MMD (cambios de forma, test por permutaciones, sobre muestras) y domain classifier (ROC AUC ≈ 0.5 = indistinguibles; Evidently alerta desde 0.55).' },
      { id: 'm12-18', kind: 'numero', q: '3 labs × 4 estadísticas por día a α = 0.05 sin cambios reales.',
        a: '12 tests/día → ≈ 18 falsas alarmas al mes y ≈ 46 % de probabilidad de al menos una por día. Efecto + sostenido + agrupado.' },
      { id: 'm12-19', kind: 'tradeoff', q: 'Histogram vs Summary en Prometheus.',
        a: 'Histogram: buckets que se suman entre pods y se consultan con histogram_quantile en cualquier ventana. Summary: cuantiles en el cliente, no agregables (y el cliente de Python no los calcula). Latencia y scores: histogram.' },
      { id: 'm12-20', kind: 'numero', q: 'Burn rates para 99.9 % en 30 días.',
        a: '14.4× (2 % del presupuesto en 1 h, ventana corta 5 min, page), 6× (5 % en 6 h, corta 30 min, page en el Workbook, ticket en c01), 1× (10 % en 3 días, corta 6 h, ticket). 14.4 × 0.1 % = 1.44 % de errores.' },
      { id: 'm12-21', kind: 'trampa', q: 'Burn rate de 14.4× con un SLO de 95 % (c04).',
        a: 'El factor no depende del objetivo: 14.4× sigue siendo 2 % del presupuesto en 1 h. Pero con 5 % de presupuesto el burn máximo es 20 y 14.4× = 72 % tarde: confirma un incidente grave. Con ≈ 86 slides/h la ventana de 5 min tiene ≈ 7 slides: c04 lo conserva con un mínimo de 10 slides en 1 h y lo complementa con la alerta adelantada de edad (más viejo &gt; 30 min sostenido 10 min, ≈ 20 min de margen).' },
      { id: 'm12-22', kind: 'trampa', q: 'Pushgateway para el job diario de drift.',
        a: 'Es el uso previsto (resultado de un batch a nivel de servicio), pero nunca olvida series: si el job muere, el último PSI queda para siempre. Alerta si push_time_seconds (el Pushgateway lo agrega por grupo) tiene más de ≈ 26 h; un gauge propio de último éxito si quieres que signifique "el cálculo salió bien".' },
      { id: 'm12-23', kind: 'numero', q: 'Logs de predicción de c01 vs loguear las imágenes.',
        a: '≈ 300 B × 10 M = 3 GB/día, ≈ US$6/mes con 90 días en S3. Imágenes: ≈ 2 TB/día = 60 TB/mes ≈ US$1,380 más cada mes, y son datos personales. Se loguean referencias.' },
      { id: 'm12-24', kind: 'concepto', q: 'Qué va en una fila de log de predicción.',
        a: 'Id (request_id o slide_id + sha256), model_version y config, referencia y resumen del input, salida y confianza, tiempos por tramo, contexto para slices. Sin imagen ni PII.' },
      { id: 'm12-25', kind: 'concepto', q: 'La señal se movió. ¿Qué descartas antes de reentrenar?',
        a: 'Un deploy tuyo (→ rollback), datos upstream rotos (→ arreglar el origen, QC) y training-serving skew (→ arreglar el código). Reentrenar solo arregla un mundo que cambió, y solo con labels del mundo nuevo.' },
      { id: 'm12-26', kind: 'concepto', q: 'Anatomía de una alerta.',
        a: 'Nombre por síntoma, condición + ventana (del SLO), severidad (page / warning / ticket), dueño, runbook_url y una acción posible. Si nadie puede hacer nada ahora, no es un page.' },
      { id: 'm12-27', kind: 'concepto', q: 'Mitigación segura ante drift dañino en c04.',
        a: 'Pasar ese laboratorio o escáner a modo silencioso: el modelo sigue corriendo, el viewer muestra "sin resultado de IA" y el patólogo trabaja como antes. Es posible porque el sistema es asistivo y la disponibilidad no es crítica.' },
      { id: 'm12-28', kind: 'frase', q: '¿Cómo resumes en inglés tu plan de monitoreo?',
        a: '"System metrics catch loud failures in minutes; input and prediction distributions tell me within hours that something changed; delayed labels tell me weeks later whether quality dropped. Pages are for user-facing symptoms from the SLO; drift opens a ticket, and a retraining trigger never deploys on its own."' },
    ],

    // ---------------------------------------------------------- glosario
    // Ya definidos en otros archivos (no se repiten): data drift, concept drift, PSI,
    // delayed labels, proxy metric, prediction logging, alert fatigue, runbook, on-call,
    // page (paging), error budget, SLI, SLO, golden signals, histogram_quantile, slice,
    // feedback loop, selection bias, retraining trigger, DCGM exporter, baseline,
    // dead-letter queue (DLQ), visibility timeout, poison message, KEDA.
    // El vocabulario de patología / WSI / human in the loop (automation bias, etc.) es de c04.
    glossary: [
      { en: 'silent failure', es: 'falla silenciosa', def: 'Cuando el servicio responde normal (200 OK, latencia y errores sanos) pero las predicciones empeoran. Solo la ven las métricas de datos, modelo y negocio.', say: 'A new stain profile in lab C is a classic silent failure: the service stays green while quality drops.' },
      { en: 'covariate shift', es: 'cambio de covariables', def: 'Otro nombre del data drift: cambia la distribución de los inputs, p(x), sin que cambie la regla que los une con el label.', say: 'The new scanner in lab C is a covariate shift, not a new definition of tumor.' },
      { en: 'label shift', es: 'cambio en la proporción de clases', def: 'Cambia p(y), cuánto hay de cada clase, sin que cambie cómo se ve cada una. También se llama prior shift.', say: 'December brings a label shift toward toys, so we check per-class thresholds.' },
      { en: 'KS test', es: 'test de Kolmogorov–Smirnov', def: 'Test de dos muestras para variables continuas; su estadístico D es la máxima distancia entre las dos distribuciones acumuladas. Con n grande casi siempre da p ≈ 0, así que se alerta sobre D, no sobre el p-value.', say: 'At our volume every KS test is significant, so we alert on the statistic, not the p-value.' },
      { en: 'chi-square test', es: 'test chi-cuadrado', def: 'Test para comparar conteos de una variable categórica entre dos muestras (o contra lo esperado). Tiene la misma trampa del n grande que el KS.', say: 'We run a chi-square test on specimen types only as a sanity check; the alert uses PSI.' },
      { en: 'Wasserstein distance', es: 'distancia de Wasserstein', def: 'Cuánta masa de probabilidad hay que mover, y qué tan lejos, para convertir una distribución en la otra (earth mover\'s distance). Es un tamaño de efecto en las unidades de la variable, no un p-value; Evidently la usa normalizada para columnas numéricas con más de 1,000 muestras.', say: 'Above a thousand samples we look at the Wasserstein distance, not the KS p-value.' },
      { en: 'Jensen–Shannon distance', es: 'distancia de Jensen–Shannon', def: 'Versión simétrica y acotada de la divergencia KL: compara cada distribución con su promedio. Se usa para variables categóricas o binneadas; va de 0 (idénticas) a 1 con logaritmo en base 2.', say: 'For specimen types we track the Jensen–Shannon distance against the reference.' },
      { en: 'maximum mean discrepancy (MMD)', es: 'discrepancia máxima de medias', def: 'Distancia entre dos distribuciones multivariadas calculada con un kernel; con un test por permutaciones da un umbral. Sirve para embeddings, sobre muestras de miles.', say: 'We compute MMD between a sample of today\'s tile embeddings and the reference.' },
      { en: 'domain classifier', es: 'clasificador de dominio', def: 'Clasificador entrenado para distinguir datos de referencia de datos actuales; si su ROC AUC es ≈ 0.5, no se distinguen. También muestra qué ejemplos cambiaron.', say: 'The domain classifier separates lab C tiles from the reference with an AUC of 0.8, so the shift is real.' },
      { en: 'embedding drift', es: 'drift de embeddings', def: 'Cambio en la distribución de los vectores de una capa intermedia (o de un encoder genérico). Atrapa cambios de contenido que las estadísticas de píxeles no ven.', say: 'Color statistics catch scanner changes; embedding drift catches new tissue types.' },
      { en: 'reference window', es: 'ventana de referencia', def: 'La muestra contra la que comparas la actual: el set de entrenamiento (lo que el modelo conoce) o una ventana reciente (lo que cambió de golpe).', say: 'We compare against both the training reference and the previous four weeks.' },
      { en: 'Prometheus', es: 'Prometheus', def: 'Sistema open source de métricas: hace scrape (pull) de <code>/metrics</code>, guarda series de tiempo, se consulta con PromQL y evalúa reglas de grabación y de alerta.', say: 'Prometheus scrapes every worker pod every fifteen seconds.' },
      { en: 'PromQL', es: 'PromQL', def: 'El lenguaje de consultas de Prometheus: rate, sum by, histogram_quantile, comparaciones para alertas.', say: 'The p99 is a PromQL histogram_quantile over the summed buckets.' },
      { en: 'Grafana', es: 'Grafana', def: 'Herramienta de dashboards que consulta fuentes como Prometheus o bases de datos; también puede evaluar alertas.', say: 'The on-call Grafana dashboard starts with the remaining error budget.' },
      { en: 'Alertmanager', es: 'Alertmanager', def: 'Componente de Prometheus que recibe alertas y las agrupa, deduplica, inhibe, silencia y enruta (page, ticket, chat) según sus labels.', say: 'Alertmanager groups the alerts of one incident into a single page.' },
      { en: 'recording rule', es: 'regla de grabación', def: 'Regla de Prometheus que precalcula una expresión cada intervalo y la guarda como serie nueva, para que dashboards y alertas no la recalculen.', say: 'Each burn-rate window is a recording rule, so the alert expression stays cheap.' },
      { en: 'Pushgateway', es: 'Pushgateway', def: 'Intermediario al que un job batch empuja métricas para que Prometheus las lea. Recomendado solo para resultados de batch a nivel de servicio; nunca olvida una serie.', say: 'The drift job pushes its PSI to the Pushgateway, and we alert when its push time is older than a day.' },
      { en: 'label cardinality', es: 'cardinalidad de labels', def: 'Cantidad de combinaciones distintas de valores de labels de una métrica; cada una es una serie. Labels con ids sin límite la hacen explotar.', say: 'Slide IDs go to logs, not labels, to keep cardinality bounded.' },
      { en: 'exemplar', es: 'exemplar', def: 'Un id de traza adjunto a algunas observaciones de un histograma, para saltar del p99 a un request concreto sin agregar labels.', say: 'From the p99 panel we jump to an exemplar trace of a slow request.' },
      { en: 'RED method', es: 'método RED', def: 'Rate, Errors, Duration: las tres métricas mínimas de un servicio request/response.', say: 'Each service dashboard starts with RED metrics per stage.' },
      { en: 'USE method', es: 'método USE', def: 'Utilization, Saturation, Errors, aplicado a cada recurso (CPU, memoria, GPU, disco, red).', say: 'We use the USE method on the GPU nodes and RED on the services.' },
      { en: 'burn rate', es: 'tasa de consumo del presupuesto', def: 'Qué tan rápido se consume el error budget respecto del ritmo que lo agotaría justo al final de la ventana del SLO. Burn rate 1 con 99.9 % = 0.1 % de errores sostenido.', say: 'A burn rate of 14.4 would empty the monthly budget in about two days.' },
      { en: 'multi-window multi-burn-rate alert', es: 'alerta de burn rate con varias ventanas', def: 'Alertas que exigen un burn rate alto en una ventana larga y en otra de 1/12 de su duración (1 h y 5 min para 14.4×): la larga confirma, la corta apaga la alerta pronto.', say: 'We page on a multi-window burn-rate alert instead of a fixed latency threshold.' },
      { en: 'age of oldest message', es: 'edad del mensaje más viejo', def: 'Cuánto lleva esperando el mensaje más antiguo de una cola; la métrica de latencia de un sistema asíncrono (en SQS, ApproximateAgeOfOldestMessage).', say: 'We alert when the age of the oldest message passes thirty minutes.' },
      { en: 'postmortem', es: 'análisis post-incidente', def: 'Documento sin culpables después de un incidente: línea de tiempo, impacto, cómo se detectó, qué lo habría detectado antes y acciones con dueño.', say: 'Every postmortem asks which signal would have caught the issue earlier.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
