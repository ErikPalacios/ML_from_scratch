/* =============================================================================
   Ronda de Diseño ML — js/content/m09-datos.js
   Módulo 09: datos y features. Por qué los incidentes de ML suelen ser de datos,
   pipelines batch y streaming (orquestación vs procesamiento vs mensajería),
   feature store y point-in-time joins, training-serving skew, data leakage,
   versionado de datos, etiquetado (calidad, kappa, costo, active learning) y
   validación de datos.
   Contrato: docs/SPEC.md §5. Los números de los casos son los de c01, c02 y c03
   (y de SPEC §8, §8b, §8c): si cambian allá, se cambian aquí.
   Verificado (sept. 2026) contra documentación oficial y PyPI: Airflow 3.3.2
   (backfills desde el scheduler, versionado de DAGs; datasets de 2.4 renombrados assets), PySpark 4.2, Flink 2.3,
   Kafka (retención por defecto 168 h; KRaft), Feast 0.66, Databricks compró Tecton
   (ago. 2025), Databricks Online Feature Stores sobre Lakebase, Vertex AI Feature
   Store (hoy Agent Platform Feature Store) legacy se apaga el 17 feb. 2027, lakeFS
   compró DVC (nov. 2025), Delta Lake
   (log 30 días, archivos borrados 7 días), Iceberg (expire snapshots 5 días por
   defecto; tags con RETAIN), Great Expectations 1.23, Pandera 0.33, TFDV 1.21,
   Label Studio (overlap, ground truth y métricas de acuerdo solo en ediciones pagas).
   Los snippets corrieron con pandas 3.0.6, Pandera 0.33.1 y scikit-learn 1.9.1
   (Python 3.14); los kappa y los cálculos, con un script.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // Marca de estimación (SPEC §5.3): subrayado punteado + "est."
  const E = (s) => '<span class="est">' + s + '</span>';

  // ------------------------------------------------------------ diagramas
  // Pipeline de datos. Carril streaming arriba (y 0–17), batch abajo (y 19–52).
  // Columnas x = 2, 28, 56, 86 con huecos de 8–12 unidades para las etiquetas.
  // "materializa" sube de Spark al online store por el hueco entre carriles (y 18.5);
  // la orquestación (punteada) va de Airflow a Spark por el hueco entre filas (y 36).
  const PIPE = {
    width: 108, height: 52,
    lanes: [
      { id: 'stream', label: 'Streaming · segundos', x: 0, y: 0, w: 108, h: 17, kind: 'online' },
      { id: 'batch', label: 'Batch · horas o días', x: 0, y: 19, w: 108, h: 33, kind: 'offline' },
    ],
    nodes: [
      { id: 'ev', label: 'Eventos', sub: 'app · pagos · clicks', x: 2, y: 5, w: 18, h: 8, kind: 'client',
        note: 'Lo que producen los sistemas del negocio mientras funcionan: clicks, transacciones, publicaciones, veredictos del SOC en c02. Llegan desordenados y a veces tarde (un celular sin señal): por eso importa el event time (<a href="#m02.streaming">M2</a>).' },
      { id: 'kafka', label: 'Kafka', sub: 'log durable · replay', x: 28, y: 5, w: 18, h: 8, kind: 'queue',
        note: 'Transporte, no procesamiento ni archivo: desacopla a quien produce de quien consume y deja releer desde un offset. Retiene 7 días por defecto (<code>log.retention.hours=168</code>, configurable): para reprocesar un año, la fuente de verdad es el data lake, no Kafka.' },
      { id: 'flink', label: 'Flink', sub: 'ventanas event time', x: 56, y: 5, w: 18, h: 8, kind: 'job',
        note: 'Procesamiento con estado por clave: "transacciones de esta tarjeta en los últimos 10 minutos". Se justifica solo si una feature tiene que reflejar lo que pasó hace segundos (fraude, sesión). Alternativas: Spark Structured Streaming (micro-batch) o Kafka Streams.' },
      { id: 'online', label: 'Online store', sub: 'último valor · ms', x: 86, y: 5, w: 20, h: 8, kind: 'store',
        note: 'Redis, DynamoDB o Bigtable con el valor más reciente de cada feature por entidad. El servicio del modelo lo lee en cada request con un lookup de milisegundos. Lo escriben dos caminos: el streaming (segundos) y la materialización del batch (horas).' },
      { id: 'db', label: 'Base operacional', sub: 'Postgres · por día', x: 2, y: 24, w: 18, h: 8, kind: 'store',
        note: 'La base de la aplicación (publicaciones, usuarios, tarjetas). No se entrena leyéndola directo: cambia debajo de ti y se sobrescribe. Se exporta al lake por día o se captura cada cambio con CDC (p. ej. Debezium hacia Kafka).' },
      { id: 'lake', label: 'Data lake', sub: 'Parquet · dt=2026-09-28', x: 28, y: 24, w: 18, h: 8, kind: 'store',
        note: 'La fuente de verdad histórica: archivos Parquet en S3 o GCS, particionados por fecha (y a veces por hora), idealmente como tablas Delta o Iceberg. Todo backfill y todo dataset de entrenamiento sale de aquí.' },
      { id: 'spark', label: 'Job Spark', sub: 'features diarias', x: 56, y: 24, w: 18, h: 8, kind: 'job',
        note: 'Procesamiento batch en paralelo sobre una partición por corrida: agregados de 7 o 30 días, conteos por vendedor, embeddings de catálogo. Idempotente (sobrescribe su partición) y parametrizado por la fecha que recibe, nunca por <code>now()</code>.' },
      { id: 'offline', label: 'Offline store', sub: 'historial con timestamps', x: 86, y: 24, w: 20, h: 8, kind: 'store',
        note: 'Cada valor de cada feature con el instante desde el que fue válido. Es lo que permite reconstruir "qué sabía el sistema" en el momento de cada evento pasado: el point-in-time join.' },
      { id: 'airflow', label: 'Airflow / Dagster', sub: 'cuándo y en qué orden', x: 2, y: 40, w: 18, h: 8, kind: 'service',
        note: 'El orquestador: dispara cada paso cuando llegan sus datos, reintenta, guarda el historial de corridas y lanza backfills. No mueve los datos: sus tareas lanzan un job de Spark o un Job de Kubernetes y esperan. Las líneas punteadas son sus disparos.' },
      { id: 'train', label: 'Entrenamiento', sub: 'job GPU · snapshot', x: 28, y: 40, w: 18, h: 8, kind: 'job',
        note: 'Solo entrena sobre un snapshot validado e inmutable, y registra su id junto al commit y al digest del contenedor. El pipeline de entrenamiento completo, el gate y el registry son <a href="#m10.pipelines-entrenamiento">M10</a>.' },
      { id: 'val', label: 'Validación', sub: 'schema · volumen', x: 56, y: 40, w: 18, h: 8, kind: 'job',
        note: 'Contrato de datos ejecutable: schema, rangos, nulos, duplicados, frescura, volumen y distribución contra el snapshot anterior. Si falla lo que bloquea, no hay entrenamiento: mejor ningún modelo nuevo que uno entrenado con datos rotos (<a href="#m09.validacion-datos">sección 8</a>).' },
      { id: 'snap', label: 'Training set', sub: 'PIT join · inmutable', x: 86, y: 40, w: 20, h: 8, kind: 'store',
        note: 'Una fila por evento con label, y cada feature con el valor que tenía en ese instante. Se escribe una vez con un id (<code>ds-2026-09-28</code>) y un manifest; nunca se edita (<a href="#m09.versionado">sección 6</a>).' },
    ],
    edges: [
      { from: 'ev', to: 'kafka', kind: 'online', label: 'eventos' },
      { from: 'kafka', to: 'flink', kind: 'online', label: 'consume' },
      { from: 'flink', to: 'online', kind: 'online', label: 'upsert' },
      { from: 'kafka', to: 'lake', kind: 'offline', fromSide: 'b', toSide: 't', label: 'sink' },
      { from: 'db', to: 'lake', kind: 'offline', label: 'export' },
      { from: 'lake', to: 'spark', kind: 'offline' },
      { from: 'spark', to: 'offline', kind: 'offline', label: 'escribe' },
      { from: 'spark', to: 'online', kind: 'offline', fromSide: 't', toSide: 'b', via: [[65, 18.5], [96, 18.5]], label: 'materializa' },
      { from: 'offline', to: 'snap', kind: 'offline', fromSide: 'b', toSide: 't', label: 'PIT join' },
      { from: 'snap', to: 'val', kind: 'offline', label: 'valida' },
      { from: 'val', to: 'train', kind: 'offline', label: 'si pasa' },
      { from: 'airflow', to: 'train', kind: 'neutral', dashed: true },
      { from: 'airflow', to: 'spark', kind: 'neutral', dashed: true, fromSide: 't', toSide: 'b', via: [[11, 36], [65, 36]] },
    ],
    flows: [
      { id: 'stream', label: 'Una feature de streaming', steps: [
        { nodes: ['ev', 'kafka'], edges: ['ev>kafka'], text: 'Un pago entra a Kafka con su <code>event_time</code> y la tarjeta como key: todos los eventos de una tarjeta caen en la misma partición y conservan su orden.' },
        { nodes: ['kafka', 'flink'], edges: ['kafka>flink'], text: 'Flink actualiza la ventana "pagos de esta tarjeta en 10 min" por event time. Si el consumer lag crece, la feature envejece sin ningún error (<a href="#m02.streaming">M2</a>).' },
        { nodes: ['flink', 'online'], edges: ['flink>online'], text: 'Escribe el valor nuevo con upsert por (tarjeta, ventana): si Flink reprocesa tras una falla, escribe lo mismo. El modelo lo lee segundos después.' },
        { nodes: ['kafka', 'lake'], edges: ['kafka>lake'], text: 'El mismo evento se archiva en el lake. Sin esa copia no podrías recalcular la feature para el pasado ni entrenar con ella.' },
      ] },
      { id: 'batch', label: 'Una feature batch diaria', steps: [
        { nodes: ['airflow', 'spark'], edges: ['airflow>spark'], text: 'Cuando la partición <code>dt=2026-09-28</code> está completa, Airflow lanza el job de Spark con esa fecha como parámetro.' },
        { nodes: ['db', 'lake', 'spark'], edges: ['db>lake', 'lake>spark'], text: 'Spark lee la partición del día (exportada de la base operacional) y calcula "publicaciones del vendedor en 30 días" para todos los vendedores.' },
        { nodes: ['spark', 'offline'], edges: ['spark>offline'], text: 'Sobrescribe su partición en el offline store: correrlo dos veces da lo mismo, y un backfill de 180 días son 180 corridas independientes.' },
        { nodes: ['spark', 'online'], edges: ['spark>online'], text: 'Materializa el último valor en el online store. Desde aquí, el serving ve la feature con hasta un día de atraso: el training tiene que ver el mismo atraso.' },
      ] },
      { id: 'dataset', label: 'Un dataset de entrenamiento', steps: [
        { nodes: ['offline', 'snap'], edges: ['offline>snap'], text: 'Para cada evento con label se toma el valor de cada feature vigente en ese instante (point-in-time join) y se escribe un snapshot con id y manifest.' },
        { nodes: ['snap', 'val'], edges: ['snap>val'], text: 'La validación compara el snapshot con su contrato y con el anterior: schema, rangos, duplicados, volumen, frescura.' },
        { nodes: ['val', 'train', 'airflow'], edges: ['val>train', 'airflow>train'], text: 'Solo si pasa, el orquestador lanza el entrenamiento, que registra el id del snapshot con el modelo. Si falla, alerta al dueño del dato y el champion sigue sirviendo.' },
      ] },
    ],
  };

  // Feature store. Tres carriles: offline (y 0–15), la definición (y 16–30), online (y 31–46).
  // El log de lo servido vuelve al offline store por el carril del medio (y 24). El pipeline
  // arranca en x 6 para que sus aristas verticales (x 16) no pisen las etiquetas de carril.
  const FS = {
    width: 100, height: 46,
    lanes: [
      { id: 'off', label: 'Offline · entrenar', x: 0, y: 0, w: 100, h: 15, kind: 'offline' },
      { id: 'def', label: 'Una definición', x: 0, y: 16, w: 100, h: 14, kind: 'neutral' },
      { id: 'on', label: 'Online · servir', x: 0, y: 31, w: 100, h: 15, kind: 'online' },
    ],
    nodes: [
      { id: 'pipe', label: 'Pipeline features', sub: 'una sola definición', x: 6, y: 20, w: 20, h: 8, kind: 'job',
        note: 'La feature se define una vez (fuente, entidad, agregación, ventana, TTL) en código versionado, y el mismo cálculo alimenta los dos stores. Es la razón de ser del feature store: sin esto, el SQL de training y el código de serving divergen.' },
      { id: 'ofs', label: 'Offline store', sub: 'historial · timestamps', x: 34, y: 5, w: 20, h: 8, kind: 'store',
        note: 'Todas las versiones de cada valor con su timestamp, en el lake o el warehouse (Parquet, Delta, Iceberg, BigQuery, Snowflake). Consultas de millones de filas en minutos.' },
      { id: 'tset', label: 'Training set', sub: 'PIT join por evento', x: 60, y: 5, w: 18, h: 8, kind: 'store',
        note: 'El join as-of: para cada evento, el último valor con timestamp ≤ el del evento (y dentro del TTL). En Feast es <code>get_historical_features</code>; en pandas, <code>merge_asof</code>.' },
      { id: 'fit', label: 'Entrenamiento', sub: 'job por snapshot', x: 84, y: 5, w: 16, h: 8, kind: 'job',
        note: 'Entrena con exactamente lo que el modelo habría visto en cada momento. Si el training set tuviera valores del futuro, la métrica offline saldría inflada.' },
      { id: 'ons', label: 'Online store', sub: 'último valor · ms', x: 34, y: 35, w: 20, h: 8, kind: 'store',
        note: 'Un KV store con el valor vigente por entidad. Su métrica de salud es la frescura: cuánto tiempo pasó desde la última materialización.' },
      { id: 'svc', label: 'Servicio online', sub: 'lookup por entidad', x: 60, y: 35, w: 18, h: 8, kind: 'service',
        note: 'Pide las features de la tarjeta o del usuario por key, arma el vector y llama al modelo. Si el lookup falla o tarda, usa el mismo valor por defecto que usó el entrenamiento para los faltantes.' },
      { id: 'log', label: 'Log de features', sub: 'lo que se sirvió', x: 84, y: 35, w: 16, h: 8, kind: 'store',
        note: 'El vector exacto que vio el modelo, con el request_id. Regla 29 de Zinkevich: entrenar con lo que se sirvió elimina el skew por construcción, a cambio de esperar a que se acumule el log.' },
    ],
    edges: [
      { from: 'pipe', to: 'ofs', kind: 'offline', fromSide: 't', toSide: 'l', via: [[16, 9]], label: 'historial' },
      { from: 'pipe', to: 'ons', kind: 'online', fromSide: 'b', toSide: 'l', via: [[16, 39]], label: 'último valor' },
      { from: 'ofs', to: 'tset', kind: 'offline', label: 'as-of' },
      { from: 'tset', to: 'fit', kind: 'offline' },
      { from: 'ons', to: 'svc', kind: 'online', label: 'get' },
      { from: 'svc', to: 'log', kind: 'async' },
      { from: 'log', to: 'ofs', kind: 'offline', fromSide: 't', toSide: 'b', via: [[92, 24], [44, 24]], label: 'entrenar con lo servido' },
    ],
    flows: [
      { id: 'entrenar', label: 'Entrenar', steps: [
        { nodes: ['pipe', 'ofs'], edges: ['pipe>ofs'], text: 'La definición calcula la feature para todo el historial y guarda cada valor con el instante desde el que es válido.' },
        { nodes: ['ofs', 'tset'], edges: ['ofs>tset'], text: 'Para cada evento con label, el join as-of toma el último valor anterior al evento. Nunca el de hoy.' },
        { nodes: ['tset', 'fit'], edges: ['tset>fit'], text: 'El entrenamiento corre sobre ese snapshot y lo registra con el modelo.' },
      ] },
      { id: 'servir', label: 'Servir', steps: [
        { nodes: ['pipe', 'ons'], edges: ['pipe>ons'], text: 'La misma definición materializa el último valor en el online store.' },
        { nodes: ['ons', 'svc'], edges: ['ons>svc'], text: 'El servicio lo lee por key en milisegundos. Mismo cálculo, mismos defaults, mismas unidades que en training.' },
      ] },
      { id: 'loop', label: 'Cerrar el loop', steps: [
        { nodes: ['svc', 'log'], edges: ['svc>log'], text: 'Cada decisión deja el vector que vio el modelo, con su request_id.' },
        { nodes: ['log', 'ofs'], edges: ['log>ofs'], text: 'El próximo entrenamiento puede usar ese log: lo que se sirvió es, por definición, lo que el modelo verá.' },
      ] },
    ],
  };

  // ------------------------------------------------------------ código
  // Corrió con pandas 3.0.6: la versión ingenua da 14 a los dos eventos; la PIT, 3 y 12.
  const PIT_CODE = `import pandas as pd

# Valores de la feature tal como existían en cada momento (una fila por actualización)
feats = pd.DataFrame({
    "card_id": [42, 42, 42, 42],
    "feature_ts": pd.to_datetime(["2026-09-01 09:00", "2026-09-01 10:00",
                                  "2026-09-01 10:30", "2026-09-01 11:00"]),
    "tx_count_1h": [1, 3, 12, 14],
})
# Eventos con label: cada transacción y el instante en que se decidió
events = pd.DataFrame({
    "card_id": [42, 42],
    "event_ts": pd.to_datetime(["2026-09-01 10:10", "2026-09-01 10:35"]),
    "is_fraud": [0, 1],
})

# Mal: "el valor más reciente" (lo que hay hoy en la tabla) para cada evento
naive = events.merge(feats.sort_values("feature_ts").groupby("card_id").tail(1), on="card_id")

# Bien: point-in-time join, el último valor con feature_ts <= event_ts (y no más viejo que 2 h)
pit = pd.merge_asof(events.sort_values("event_ts"), feats.sort_values("feature_ts"),
                    left_on="event_ts", right_on="feature_ts", by="card_id",
                    direction="backward", tolerance=pd.Timedelta("2h"))

print(naive[["event_ts", "is_fraud", "tx_count_1h"]])   # 14 y 14
print(pit[["event_ts", "is_fraud", "feature_ts", "tx_count_1h"]])   # 3 y 12`;

  // Corrió con pandas 3.0.6 y Pandera 0.33.1 (tests en el scratchpad), con `now` en UTC:
  // pasa un snapshot sano y la mezcla del manifest (72 % débiles); atrapa sha duplicado,
  // label fuera de rango, exceso de labels débiles, volumen, frescura, timestamps sin zona
  // y una columna faltante (devuelve el error en vez de reventar).
  const VALIDATE_CODE = `import pandas as pd
import pandera.pandas as pa   # import recomendado para pandas en Pandera ≥ 0.24

# Timestamps con zona UTC explícita: uno "naive" es hora local de quién sabe dónde
utc = pa.Check(lambda s: isinstance(s.dtype, pd.DatetimeTZDtype) and str(s.dtype.tz) == "UTC",
               error="timestamp sin zona UTC")

# Contrato de una fila del manifest de entrenamiento (c01)
schema = pa.DataFrameSchema(
    {
        "image_sha256": pa.Column(str, pa.Check.str_matches(r"^[0-9a-f]{64}$"), unique=True),
        "seller_id": pa.Column(str, nullable=False),
        "label_id": pa.Column(int, pa.Check.in_range(0, 499)),        # 500 categorías
        "label_source": pa.Column(str, pa.Check.isin(["humano", "moderador", "vendedor_filtrado"])),
        "width": pa.Column(int, pa.Check.ge(64)),
        "height": pa.Column(int, pa.Check.ge(64)),
        "created_at": pa.Column(checks=utc),
    },
    strict=True,   # una columna nueva o renombrada también rompe el contrato
)

def validate(df: pd.DataFrame, prev: pd.DataFrame, now: pd.Timestamp) -> list[str]:
    errors = []                                         # now en UTC: pd.Timestamp.now(tz="UTC")
    try:
        schema.validate(df, lazy=True)                  # lazy: junta TODAS las fallas
    except pa.errors.SchemaErrors as e:
        fc = e.failure_cases[["column", "check"]].drop_duplicates()
        errors += [f"schema: {c} · {chk}" for c, chk in fc.values]
        if (fc["check"] == "column_in_dataframe").any():
            return errors                               # falta una columna: lo demás no se puede calcular
    if not 0.8 <= len(df) / len(prev) <= 1.5:           # volumen vs snapshot anterior
        errors.append(f"volumen: {len(df)} filas vs {len(prev)} antes")
    ts = df["created_at"]
    if isinstance(ts.dtype, pd.DatetimeTZDtype) and now - ts.max() > pd.Timedelta("48h"):   # frescura
        errors.append("frescura: el dato más nuevo tiene más de 48 h")
    weak = df["label_source"].eq("vendedor_filtrado").mean()
    if weak > 0.8:                                      # mezcla de fuentes de label
        errors.append(f"labels débiles = {weak:.0%} del snapshot (tope 80 %)")
    return errors`;

  const VALIDATE_OUT = `ok: []
mal: ['schema: image_sha256 · field_uniqueness', 'schema: label_id · in_range(0, 499)',
      'labels débiles = 85% del snapshot (tope 80 %)']
chico y viejo: ['volumen: 500 filas vs 1000 antes', 'frescura: el dato más nuevo tiene más de 48 h']
naive: ['schema: created_at · timestamp sin zona UTC']`;

  // Validado como JSON con Python. Es la "tarjeta" de un snapshot de c01.
  const MANIFEST = `{
  "snapshot_id": "ds-2026-09-01",
  "parent": "ds-2026-08-01",
  "created_at": "2026-09-01T03:12:44Z",
  "rows_path": "s3://ml-datos/datasets/ds-2026-09-01/rows.parquet",
  "rows_sha256": "9f2c…",
  "images": {"humano": "s3://ml-datos/labeled/ (restringido, sin EXIF)",
             "resto": "storage del producto (por key + sha256, no se copian)"},
  "counts": {"train": 1840211, "val": 92417, "golden": "golden-v3 (aparte, congelado)"},
  "label_sources": {"humano": 0.21, "moderador": 0.07, "vendedor_filtrado": 0.72},
  "split": "por seller_id (hash mod 100 < 95 → train); dedupe por sha256 y pHash",
  "code": {"repo": "ml-catalogo", "commit": "4be1d0a"},
  "validation": {"status": "passed", "report": "s3://ml-datos/datasets/ds-2026-09-01/validation.json"}
}`;

  // ------------------------------------------------------------ registro
  MSD.register({
    id: 'm09',
    kind: 'module',
    sections: [
      // ======================================================== 1
      {
        id: 'por-que-datos',
        title: 'Por qué los datos deciden más que el modelo',
        titleEn: 'Why data, not the model, breaks in production',
        priority: 'core',
        dims: ['arquitectura', 'comunicacion'],
        blocks: [
          { t: 'p', html: `En tu notebook, el dataset es una carpeta que no cambia: bajas CIFAR o ImageNet, haces un split y entrenas. En producción, el dataset es un <b>proceso</b> que no se detiene: llegan datos todos los días, los produce otro equipo, los etiquetan personas con criterios que se mueven y los transportan pipelines que pueden fallar sin avisar. El modelo es una función de datos y código; el código lo cambias pocas veces al mes, los datos cambian solos todos los días.` },
          { t: 'p', html: `Por eso los incidentes de ML más caros suelen ser de datos, y son silenciosos: el servicio responde 200, la latencia está bien y las predicciones empeoran. No tengo una estadística confiable que te dé un porcentaje, y desconfía de quien la cite sin fuente. Lo que sí es consistente en lo que publican los practicantes (Sculley et al., <i>Hidden Technical Debt in Machine Learning Systems</i>, NeurIPS 2015; Breck et al., <i>Data Validation for Machine Learning</i>, SysML 2019; las <i>Rules of Machine Learning</i> de Martin Zinkevich) es que la deuda y los errores se acumulan en los datos y en el pegamento alrededor del modelo, no en la arquitectura de la red.` },
          { t: 'table', caption: 'Los incidentes de datos de los casos publicados', head: ['Caso', 'Qué pasó (o pasaría)', 'Cómo se ve', 'Qué lo evita'], rows: [
            ['<a href="#c01.datos">c01</a>', 'El servicio decodifica con OpenCV (BGR) y el entrenamiento usó PIL (RGB)', 'La accuracy online cae varios puntos; ninguna excepción', 'Un solo <code>preprocess.py</code> y un test de tensores de referencia (<a href="#m09.skew">sección 4</a>)'],
            ['<a href="#c01.datos">c01</a>', 'Entrenar con la categoría que eligió el vendedor, que casi siempre acepta tu primera sugerencia', 'La métrica offline sube y la calidad real no', 'Evaluar con labels humanos y un holdout sin sugerencias (<a href="#m09.etiquetado">sección 7</a>)'],
            ['<a href="#c02.datos">c02</a>', 'Una cámara con telarañas genera cientos de descartes por semana y entran todos al dataset', 'El modelo aprende esa cámara y olvida las demás', 'Tope de ejemplos por cámara y por semana'],
            ['<a href="#c02.datos">c02</a>', 'Frames consecutivos de la misma cámara caen en train y en test', 'La métrica offline miente hacia arriba', 'Split por cámara y fecha (<a href="#m09.leakage">sección 5</a>)'],
            ['<a href="#c03.datos">c03</a>', 'Imágenes de la línea sin filtrar entran como "piezas buenas"', 'La anomalía aprende a no marcar los defectos más comunes', 'Filtrar por score y auditar una muestra antes de usarlas'],
            ['<a href="#c03.datos">c03</a>', 'El recall se calcula solo con defectos que el propio modelo desvió', 'Recall inflado: los escapes no aparecen en tus datos', 'Golden set con defectos de fuentes independientes del modelo'],
            ['Cualquiera', 'El equipo de origen cambia una columna de centímetros a milímetros', 'Una feature 10× más grande; el modelo la usa igual', 'Validación de rangos y distribuciones (<a href="#m09.validacion-datos">sección 8</a>)'],
          ] },
          { t: 'h3', text: 'El data flywheel: el sistema que produce modelos' },
          { t: 'p', html: `Un sistema de ML sano es un ciclo que gira: cada vuelta junta mejores datos donde el modelo falla, y cada modelo nuevo produce mejores candidatos para la vuelta siguiente. Si se corta en cualquier punto (los labels no se pueden unir a la predicción que los originó, el dataset no está versionado, nadie elige qué etiquetar), el ciclo no gira y el modelo se congela mientras el mundo cambia.` },
          { t: 'steps', items: [
            { title: 'Servir y loguear', meta: 'cada request', html: 'Predicción con <code>model_version</code>, <code>request_id</code> y lo que vio el modelo (en c01, referencias al 1 % de las imágenes; en c03, una línea JSON por pieza).' },
            { title: 'Elegir qué etiquetar', meta: 'active learning', html: 'Incertidumbre, desacuerdos y una muestra aleatoria. En c01, ≈ 5k imágenes al mes; en c02, veredictos del SOC y frames aleatorios; en c03, rechazos y casi-rechazos.' },
            { title: 'Etiquetar', meta: 'humanos', html: 'Con guía, preguntas de control y doble anotación parcial. Los labels se guardan como eventos con autor y hora, unidos a la predicción por id.' },
            { title: 'Congelar un snapshot', meta: 'inmutable', html: 'Un id, un manifest y una regla de split que no mezcla entidades ni tiempos.' },
            { title: 'Validar', meta: 'antes de entrenar', html: 'Schema, rangos, duplicados, volumen y frescura. Si falla, no se entrena.' },
            { title: 'Entrenar y pasar el gate', meta: '<a href="#m10.gate">M10</a>', html: 'Challenger contra champion en el golden set y por slices; el modelo registrado apunta a su snapshot.' },
            { title: 'Desplegar con cuidado', meta: '<a href="#m11">M11</a>', html: 'Shadow, canary, A/B. Y vuelta al paso 1.' },
          ] },
          { t: 'callout', kind: 'why', title: 'Por qué el entrevistador pregunta por los datos', html: `<p>Casi todos los candidatos saben dibujar un model server. Pocos saben responder "¿de dónde salen tus labels y qué sesgo tienen?" o "¿cómo sabes que la feature que ves en serving es la misma que viste en training?". Esas dos preguntas separan a quien entrenó un modelo de quien operó uno, y por eso aparecen aunque el enunciado hable de latencia. En la plantilla de casos es la <a href="#c01.datos">sección 6</a>; en los 45 minutos, 3–4 minutos bien usados.</p>` },
          { t: 'callout', kind: 'interview', html: `<ul><li>"Before the model, I want to know where the labels come from, how fast they arrive and what bias they carry, because that decides most of the design."</li><li>"The goal isn't one model, it's a loop: log predictions, pick what to label, label it, snapshot, validate, retrain behind a gate."</li></ul>` },
          { t: 'callout', kind: 'connect', html: `<p>El ciclo de vida completo está en <a href="#m01.ciclo-de-vida">M1</a>. Este módulo cubre la mitad de datos; el pipeline de entrenamiento, el registry y el gate son <a href="#m10">M10</a>; cómo se detecta que los datos de producción cambiaron (drift) es <a href="#m12">M12</a>.</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'pipelines',
        title: 'Pipelines batch y streaming',
        titleEn: 'Batch and streaming data pipelines',
        priority: 'core',
        dims: ['arquitectura', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Un pipeline de datos mueve y transforma datos desde donde nacen hasta donde el modelo los consume: el dataset de entrenamiento, el offline store o el online store. El error de nivel junior es nombrar herramientas como si fueran intercambiables ("uso Airflow o Kafka para el pipeline"). Son tres roles distintos, y en una arquitectura seria conviven.` },
          { t: 'table', caption: 'Tres roles que se confunden', head: ['Rol', 'Qué hace', 'Herramientas', 'Qué NO hace'], rows: [
            ['<b>Orquestación</b>', 'Decide cuándo corre cada paso y en qué orden, reintenta, guarda el historial de corridas y lanza backfills', 'Airflow, Dagster, Argo Workflows, Prefect; para ML, Kubeflow, SageMaker o Vertex AI Pipelines (hoy Agent Platform Pipelines; <a href="#m10.pipelines-entrenamiento">M10</a>)', 'No procesa los datos: sus tareas lanzan un job y esperan. Pasar 200 GB por un worker de Airflow es un antipatrón'],
            ['<b>Procesamiento batch</b>', 'Transforma volúmenes grandes y acotados en paralelo', 'Spark, SQL en el warehouse (BigQuery, Snowflake, a menudo con dbt), Ray Data', 'No decide cuándo correr ni reintenta la cadena completa'],
            ['<b>Procesamiento streaming</b>', 'Procesa eventos continuos con estado por clave y ventanas', 'Flink, Spark Structured Streaming, Kafka Streams', 'No es el archivo histórico de los eventos'],
            ['<b>Mensajería / log</b>', 'Transporta eventos de forma durable, desacopla productores y consumidores, permite releer', 'Kafka, Kinesis, Pub/Sub', 'No transforma. Retiene por un tiempo limitado (Kafka: 7 días por defecto, configurable)'],
          ] },
          { t: 'callout', kind: 'trap', title: 'Kafka como base de datos, Airflow como motor de cómputo', html: `<p>Dos frases que un entrevistador anota en contra. "Reprocesamos el año pasado leyendo Kafka": con la retención por defecto, el topic tiene una semana; la fuente de verdad histórica es el data lake, donde un sink archiva cada evento. "La tarea de Airflow lee el Parquet y calcula las features": el worker de Airflow no está hecho para eso (memoria, paralelismo, reintentos a mitad de camino); la tarea lanza un job de Spark o un Job de Kubernetes con la fecha como parámetro y solo espera su resultado.</p>` },
          { t: 'h3', text: 'Batch vs streaming' },
          { t: 'table', head: ['Aspecto', 'Batch', 'Streaming'], rows: [
            ['Frescura', 'Horas a un día', 'Segundos'],
            ['Reprocesar', 'Fácil: vuelves a correr una partición con el código nuevo', 'Replay limitado a la retención del log; recalcular el pasado exige un job batch que imite la lógica del stream'],
            ['Completitud', 'La partición está completa cuando corres', 'Eventos tardíos: el watermark decide cuánto esperar (<a href="#m02.streaming">M2</a>)'],
            ['Operación', 'Un job que termina; si falla, reintentas', 'Un servicio siempre encendido con estado, checkpoints y consumer lag que vigilar'],
            ['Costo', 'Cómputo solo mientras corre (y en spot)', 'Cómputo 24/7, aunque el tráfico sea bajo'],
            ['Cuándo', 'Casi siempre: features de largo plazo, datasets de entrenamiento, backfills', 'Solo donde la frescura cambia la decisión: fraude (<a href="#c09">c09</a>), sesión en recomendación (<a href="#c08">c08</a>)'],
          ] },
          { t: 'p', html: `El default es batch, y streaming solo para las features que lo necesitan. En los tres casos de visión publicados no hay features de streaming: en c01 y c03 el input es la imagen; en c02 los eventos de detección viajan en tiempo real, pero eso es inferencia sobre un stream, no un pipeline de features. Donde el streaming se gana su costo es en fraude: un ataque de card testing dura minutos y una feature diaria no lo ve (<a href="#m02.streaming">M2</a>).` },
          { t: 'diagram', id: 'pipeline-datos', title: 'Un pipeline de datos con sus tres roles', caption: 'Arriba, el camino de segundos (Kafka → Flink → online store); abajo, el batch que alimenta el offline store y el dataset de entrenamiento. Las líneas punteadas son disparos del orquestador. Toca cada caja y recorre los tres flujos.', spec: PIPE },
          { t: 'h3', text: 'Particionado, idempotente, backfillable' },
          { t: 'p', html: `Son las tres propiedades que un entrevistador busca en cualquier job de datos, porque son las que te dejan recuperarte de una falla sin corromper nada.` },
          { t: 'table', head: ['Propiedad', 'Qué significa', 'Cómo se rompe', 'Cómo se logra'], rows: [
            ['<b>Particionado</b>', 'Los datos se guardan por fecha (<code>dt=2026-09-28</code>) o por hora; cada corrida procesa una partición', 'Una tabla única que se reescribe entera cada noche: reprocesar un día obliga a reprocesar todo', 'Rutas o tablas particionadas por fecha; cada corrida lee y escribe solo la suya'],
            ['<b>Idempotente</b>', 'Correr dos veces da el mismo resultado que correr una', 'El job hace <i>append</i>; un reintento tras una falla duplica las filas y la feature "compras en 7 días" se duplica', 'Sobrescribir la partición completa (<code>INSERT OVERWRITE</code>, ruta determinista) o upsert por key; nunca append ciego'],
            ['<b>Backfillable</b>', 'Puedes correr el código de hoy sobre fechas pasadas', 'El código usa <code>now()</code> o "los últimos 7 días desde hoy": un backfill de marzo calcula valores de septiembre y los pega en marzo', 'El job recibe la fecha (o el intervalo) de la partición como parámetro y no mira el reloj'],
          ] },
          { t: 'callout', kind: 'trap', title: 'now() dentro de una feature es leakage esperando a ocurrir', html: `<p>Una feature de 30 días calculada con <code>now() - 30 days</code> funciona en la corrida diaria y está mal en cualquier backfill: cada fecha pasada recibe los 30 días anteriores a <b>hoy</b>, que incluyen el futuro de esa fecha. Es la forma más común de meter información del futuro al training sin darte cuenta (<a href="#m09.leakage">sección 5</a>). La fecha de referencia siempre llega como parámetro desde el orquestador.</p>` },
          { t: 'calc', title: 'Backfill de una feature nueva con 180 días de historia', rows: [
            { label: 'Particiones', expr: '180 días × 1', value: '180 corridas' },
            { label: 'Tiempo por partición en el cluster', expr: 'mídelo', value: E('≈ 20 min') },
            { label: 'En serie', expr: '180 × 20 min', value: '60 h' },
            { label: 'Con 12 en paralelo', expr: '60 h / 12', value: '5 h' },
          ], result: 'Particionar e idempotencia convierten un backfill de dos días y medio en una tarde, y hacen que una corrida fallida se reintente sola sin duplicar nada. Airflow 3 lanza y sigue los backfills desde el scheduler (UI o API); Dagster los maneja por particiones de assets. Pon un tope de paralelismo: 180 jobs a la vez contra la misma base operacional es un incidente para otro equipo.' },
          { t: 'callout', kind: 'senior', html: `<p>Pregunta quién es el dueño de cada fuente y qué pasa cuando la cambia. Un pipeline de datos depende de tablas que otro equipo puede renombrar mañana. La respuesta senior es un <b>data contract</b>: el productor publica el schema y la semántica (unidades, zona horaria, significado de un nulo), los cambios incompatibles se anuncian y la validación del consumidor corre en cada partición. Y di quién recibe la alerta cuando el job de las 3 a. m. falla: un job sin dueño es un job que falla tres noches seguidas.</p>` },
          { t: 'callout', kind: 'skip', html: `<p>Tuning de Spark (shuffles, número de particiones, broadcast joins) y los internos de Flink (state backends, checkpoint barriers, savepoints) casi nunca salen en una ronda de MLE. Basta con saber qué rol cumple cada herramienta y las tres propiedades de arriba. Event time, ventanas y consumer lag están en <a href="#m02.streaming">M2</a>; at-least-once con sink idempotente, en <a href="#m02.entrega-reintentos">M2</a>.</p>` },
          { t: 'callout', kind: 'interview', html: `<ul><li>"Airflow only orchestrates: each task launches a Spark job with the partition date as a parameter, so any day can be rerun or backfilled."</li><li>"Every job overwrites its own partition, so retries are idempotent and never double-count."</li><li>"Only the velocity features go through Kafka and Flink; everything else is a daily batch job, because a day of staleness doesn't change the decision."</li></ul>` },
          { t: 'callout', kind: 'connect', html: `<p>El patrón de inferencia batch (precomputar predicciones, swap atómico) es <a href="#m02.batch">M2</a>; las features de streaming con Kafka y Flink, <a href="#m02.streaming">M2</a>; el pipeline que entrena y registra el modelo, <a href="#m10.pipelines-entrenamiento">M10</a>.</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'feature-store',
        title: 'Feature store: una definición para entrenar y servir',
        titleEn: 'Feature stores and point-in-time correctness',
        priority: 'core',
        dims: ['arquitectura', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Piensa en un modelo de fraude (<a href="#c09">c09</a>). Una de sus features es "transacciones de esta tarjeta en la última hora". Sin un feature store, se calcula dos veces: en SQL sobre el data lake para armar el dataset de entrenamiento, y en Java o Python dentro del servicio para cada transacción en vivo. Dos implementaciones del mismo concepto divergen (una cuenta los reembolsos, la otra no) y el modelo ve en producción algo distinto de lo que aprendió. Además, para entrenar necesitas el valor que tenía esa feature <b>en el instante</b> de cada transacción pasada, no el de hoy.` },
          { t: 'p', html: `Un feature store resuelve cuatro cosas: (1) <b>una sola definición</b> de cada feature que alimenta training y serving; (2) un <b>offline store</b> con el historial completo y joins point-in-time; (3) un <b>online store</b> con el último valor por entidad a milisegundos; (4) un <b>registry</b> para descubrir y reutilizar features entre equipos y modelos.` },
          { t: 'diagram', id: 'feature-store', title: 'Una definición, dos stores y el loop del log', caption: 'La misma definición escribe el historial (offline) y el último valor (online). Toca cada caja y recorre los tres flujos.', spec: FS },
          { t: 'table', caption: 'Offline store vs online store', head: ['Aspecto', 'Offline store', 'Online store'], rows: [
            ['Qué guarda', 'Todas las versiones de cada valor, con timestamps', 'El último valor por entidad'],
            ['Dónde', 'Lake o warehouse: Parquet, Delta, Iceberg, BigQuery, Snowflake', 'KV store: Redis, DynamoDB, Bigtable, Cassandra'],
            ['Consulta típica', 'Join as-of de millones de eventos, en minutos', '<code>get(card_id=42)</code> en milisegundos'],
            ['Quién lo lee', 'Entrenamiento y scoring batch', 'El servicio online en cada request'],
            ['Falla típica', 'Leakage si el join no es point-in-time', 'Valores viejos si la materialización se atrasa'],
          ] },
          { t: 'h3', text: 'Point-in-time join con números' },
          { t: 'p', html: `La tarjeta 42 hace una compra legítima a las 10:10. A las 10:25 alguien empieza a probar la tarjeta robada con compras chicas, y a las 10:35 llega una transacción fraudulenta. La feature <code>tx_count_1h</code> se recalcula cada media hora o cada hora:` },
          { t: 'table', caption: 'Historial de la feature (offline store)', head: ['feature_ts', 'card_id', 'tx_count_1h'], rows: [
            ['09:00', '42', '1'],
            ['10:00', '42', '3'],
            ['10:30', '42', '12'],
            ['11:00', '42', '14'],
          ] },
          { t: 'table', caption: 'Dos formas de unir la feature a los eventos con label', head: ['Evento', 'Label', 'Join ingenuo (valor de hoy)', 'Point-in-time (último valor ≤ evento)'], rows: [
            ['10:10', 'legítima', '14', '3 (de las 10:00)'],
            ['10:35', 'fraude', '14', '12 (de las 10:30)'],
          ] },
          { t: 'p', html: `Con el join ingenuo, la compra legítima de las 10:10 entra al training con 14 transacciones en la última hora, un valor que se calculó después y que incluye el ataque. El modelo aprende una relación que no existe al momento de decidir. Con el join point-in-time, cada evento ve solo lo que el sistema sabía en su instante. En código:` },
          { t: 'code', title: 'Point-in-time join en pandas', caption: 'Corrió con pandas 3.0.6: el join ingenuo da 14 a los dos eventos; <code>merge_asof</code> da 3 y 12. Un feature store hace esto a escala (en Feast, <code>get_historical_features</code> con el TTL de cada feature view).', files: [
            { name: 'pit_join.py', lang: 'python', code: PIT_CODE },
          ] },
          { t: 'callout', kind: 'trap', title: 'El TTL también es parte de la definición', html: `<p>Si la tarjeta no tuvo actualizaciones en tres semanas, el join as-of encontraría un valor de hace tres semanas y lo usaría como si fuera actual. En serving, el online store probablemente ya lo expiró y el servicio usa el valor por defecto. Resultado: training y serving tratan distinto al mismo caso. El <code>tolerance</code> de <code>merge_asof</code> y el TTL de un feature view existen para eso: más viejo que el TTL es faltante, en los dos lados.</p>` },
          { t: 'callout', kind: 'senior', html: `<p>El timestamp que importa no es cuándo terminó la ventana, sino cuándo el valor <b>estuvo disponible</b> para el servicio. Si la materialización tarda 2 minutos en llegar al online store, la decisión de las 10:31 todavía vio el valor de las 10:00, y el training tiene que simular ese atraso. La alternativa radical es la regla 29 de Zinkevich: loguear el vector que se sirvió y entrenar con ese log. Parity perfecta por construcción; el costo es que una feature nueva no tiene historia (hay que esperar semanas a que se acumule: <i>log-and-wait</i>) y no puedes hacer backfill de algo que nunca se logueó.</p>` },
          { t: 'tradeoffs', items: [
            { option: 'Feature store (Feast o administrado)', verdict: 'depende', pros: 'Una definición, PIT joins correctos sin escribirlos, online store con materialización, reutilización entre equipos.', cons: 'Un sistema más que operar (o pagar), otra abstracción que aprender, y no te salva de definiciones malas.', why: 'Vale cuando hay muchas features de entidades (usuario, tarjeta, comercio), varias de ellas frescas, y más de un modelo o equipo que las comparte: fraude, recomendación, ads, pricing.' },
            { option: 'Loguear lo servido y entrenar con el log', verdict: 'elegido', pros: 'Cero skew por construcción; simple de razonar.', cons: 'Features nuevas sin historia (log-and-wait); el log hay que guardarlo, versionarlo y unirlo a labels que llegan tarde.', why: 'Es el complemento de cualquier opción: aunque tengas feature store, loguear el vector servido te da la verdad para detectar skew (<a href="#m09.skew">sección 4</a>).' },
            { option: 'Mismo código compartido, sin feature store', verdict: 'depende', pros: 'Una librería que importan el job batch y el servicio; nada nuevo que operar.', cons: 'Los PIT joins, la materialización y el TTL los escribes tú; se vuelve un feature store casero a medida que crece.', why: 'Bien con pocos modelos y pocas features; revisa la decisión cuando el tercer equipo te pida tus features.' },
            { option: 'Feature store en c01 y c03', verdict: 'descartado', pros: 'Ninguno relevante.', cons: 'Infraestructura para un problema que no tienen.', why: 'Su input es una imagen: no hay agregados por entidad que calcular ni que mantener frescos. La consistencia la da un paquete de preprocesamiento compartido.' },
          ] },
          { t: 'h3', text: 'Cuándo NO necesitas uno' },
          { t: 'p', html: `En <a href="#c01.datos">c01</a> la única "feature" es la foto, preprocesada por <code>preprocess.py</code>: el problema de consistencia existe, pero lo resuelve un paquete compartido y un parity test, no un feature store. En <a href="#c03.datos">c03</a>, además, la línea corre sin conexión 72 h; un online store remoto sería un punto de falla. En <a href="#c02.datos">c02</a>, los polígonos de zona y el dwell por cámara son configuración versionada, no features. Proponer un feature store en un caso de visión sin features tabulares es una señal de que memorizaste un diagrama.` },
          { t: 'callout', kind: 'skip', html: `<p>Sáltate la tabla que sigue si vas corto de tiempo: en la entrevista basta "Feast si lo operas tú, el administrado de tu nube si ya vives ahí". Nadie te va a preguntar versiones ni quién compró a quién.</p>` },
          { t: 'table', caption: 'Herramientas (estado en septiembre de 2026; verifica antes de proponer)', head: ['Herramienta', 'Qué es', 'A tener en cuenta'], rows: [
            ['Feast', 'Open source. Define features en Python; offline sobre tu warehouse o lake, online en Redis, DynamoDB y otros', 'Tú operas los stores y la materialización; el cómputo pesado de las features suele seguir en tu Spark o tu warehouse'],
            ['Tecton', 'Feature store administrado, fuerte en features en tiempo real', 'Hoy es parte de Databricks: si lo evalúas, pregunta por su hoja de ruta fuera de Databricks'],
            ['Databricks Feature Store', 'Features como tablas de Unity Catalog, PIT joins, linaje', 'Online stores sobre Lakebase; tiene sentido si ya vives en Databricks'],
            ['SageMaker Feature Store', 'Online store y offline store en S3, administrados', 'Encaja en un stack AWS; revisa costos de escritura online'],
            ['Vertex AI Feature Store (hoy Agent Platform Feature Store)', 'La versión actual usa BigQuery como fuente y agrega serving online', 'La versión legacy y su "optimized online serving" están deprecados (se apagan en febrero de 2027): Google recomienda serving sobre Bigtable. Google renombró Vertex AI como Gemini Enterprise Agent Platform en su documentación; en entrevista, "Vertex AI" se sigue entendiendo'],
          ] },
          { t: 'callout', kind: 'interview', html: `<ul><li>"I'd only add a feature store if we have entity features shared across models; for an image classifier, a shared preprocessing package does the job."</li><li>"Training data is built with a point-in-time join, so each example only sees feature values that existed at decision time."</li><li>"We also log the exact feature vector we served, which gives us a ground truth for skew checks."</li></ul>` },
        ],
      },

      // ======================================================== 4
      {
        id: 'skew',
        title: 'Training-serving skew: causas, detección y prevención',
        titleEn: 'Training-serving skew',
        priority: 'core',
        dims: ['monitoreo', 'arquitectura'],
        blocks: [
          { t: 'p', html: `El modelo de c01 da 85 % de top-1 en el golden set. Lo despliegas, la tasa de aceptación sale peor de lo esperado y, cuando mandas imágenes etiquetadas por el gateway real, el top-1 es 80 %. No hay errores en los logs. Si entre el entrenamiento y el serving cambió la <b>forma de calcular</b> la entrada, tienes training-serving skew: el modelo ve en producción inputs distribuidos distinto de los que aprendió, por culpa de tu sistema, no del mundo.` },
          { t: 'table', caption: 'Skew no es drift', head: ['', 'Training-serving skew', 'Drift (<a href="#m12.drift">M12</a>)'], rows: [
            ['Causa', 'Tu pipeline calcula distinto en training y en serving', 'El mundo cambió: productos nuevos, cámaras nuevas, otra estación del año'],
            ['Cuándo aparece', 'Desde el primer día del despliegue, o justo después de un cambio de código o de librería', 'Gradual, o de golpe por un evento externo'],
            ['Arreglo', 'Corregir el código; reentrenar no ayuda', 'Datos nuevos y reentrenamiento'],
            ['Cómo se detecta', 'Mismos ejemplos por los dos caminos: los valores deberían ser idénticos', 'Distribución de hoy contra una referencia'],
          ] },
          { t: 'table', caption: 'Causas típicas', head: ['Causa', 'Ejemplo', 'Cómo se ve', 'Prevención'], rows: [
            ['Dos caminos de código', 'SQL offline vs Java online para "compras en 7 días"; uno cuenta devoluciones', 'Offline bien, online peor; peor en los usuarios con devoluciones', 'Una definición (feature store) o una librería compartida'],
            ['Preprocesamiento de imagen', 'PIL (RGB) vs OpenCV (BGR); bilinear vs bicubic; resize antes o después del crop; JPEG draft mode; orientación EXIF ignorada en un lado', 'La accuracy cae varios puntos sin excepciones; fotos rotadas de celular fallan más', 'Un solo <code>preprocess.py</code> que importan training, evaluación y gateway (<a href="#c01.datos">c01</a>) y un test de tensores de referencia en CI'],
            ['Features viejas', 'El online store se materializa cada 6 h; el training usó el valor exacto del momento', 'El modelo confía en una señal que en serving llega tarde', 'Entrenar con el atraso real y alertar sobre la frescura'],
            ['Faltantes', 'Offline, null → media de la columna; online, timeout del lookup → 0', 'Predicciones raras en los picos, cuando más lookups fallan', 'El mismo valor por defecto en los dos lados, y una métrica de cuántas veces se usó'],
            ['Zonas horarias', '"Hora del día" en UTC en training y en hora local en serving (CDMX es UTC−6 todo el año desde 2022)', 'La feature queda corrida 6 horas', 'Timestamps con zona explícita en todo el pipeline; convertir a local en un solo lugar'],
            ['Vocabularios y orden de clases', 'El mapeo id → categoría cambió entre versiones', 'Predicciones de otra clase con confianza alta', 'El <code>labels.json</code> versionado dentro del artefacto del modelo, como en c01'],
            ['Versiones de librerías', 'Otra versión de Pillow, OpenCV o torchvision en la imagen de serving', 'Diferencias chicas en los tensores, a veces medibles en la métrica', 'Dependencias fijadas y la misma imagen base; parity end-to-end en CI'],
            ['Precisión numérica', 'Engine FP16 de TensorRT vs PyTorch FP32', 'Desacuerdo pequeño en el top-1', 'Parity test del engine (<a href="#m08.validar">M8</a>)'],
          ] },
          { t: 'h3', text: 'Cómo se detecta' },
          { t: 'steps', items: [
            { title: 'Loguear en serving', meta: 'con request_id', html: 'El vector de features tal como lo vio el modelo. En imágenes, no hace falta guardar cada tensor: el hash de la imagen de entrada y estadísticas del tensor (media y desviación por canal) para una muestra, más los tensores completos de un puñado de imágenes de referencia.' },
            { title: 'Recalcular por el camino de training', meta: 'mismos ejemplos', html: 'Toma esos mismos ejemplos, pásalos por el pipeline de entrenamiento y compara feature por feature: tasa de coincidencia exacta y diferencia absoluta máxima. Aquí no hay umbral estadístico: deberían ser iguales.' },
            { title: 'Parity end-to-end', meta: 'en CI y en shadow', html: 'Imágenes de referencia por el gateway real contra las predicciones del pipeline de evaluación (<a href="#c01.evaluacion">c01</a>). Atrapa el skew de preprocesamiento, no solo el del engine.' },
            { title: 'Comparar distribuciones', meta: 'complemento', html: 'Distribución de cada feature en serving vs training (PSI). Útil, pero ambiguo: una diferencia puede ser skew o drift. El paso 2 separa los dos.' },
          ] },
          { t: 'callout', kind: 'trap', title: '"Reentrenamos y se arregla"', html: `<p>Si reentrenas con features logueadas desde un serving que decodifica en BGR, el modelo nuevo aprende a funcionar con BGR y el problema desaparece de la métrica... hasta que alguien arregla el gateway. El skew se corrige en el código, con un test que impida que vuelva. Reentrenar para tapar un bug de pipeline es convertir un bug en una dependencia.</p>` },
          { t: 'callout', kind: 'senior', html: `<p>El shadow deployment (<a href="#m11.shadow">M11</a>) es el lugar natural para atrapar skew antes de que lo vea un usuario: el challenger recibe tráfico real por el camino de serving real y comparas sus predicciones con las del pipeline offline para las mismas entradas. Y di la regla 32 de Zinkevich en voz alta: reutilizar código entre training y serving siempre que se pueda.</p>` },
          { t: 'callout', kind: 'interview', html: `<ul><li>"Training, evaluation and the gateway import the same preprocessing package, and CI checks the tensors for twenty reference images against stored ones."</li><li>"To tell skew from drift, I recompute the logged serving inputs through the training pipeline: if the same example gives different values, it's skew, and retraining won't fix it."</li></ul>` },
        ],
      },

      // ======================================================== 5
      {
        id: 'leakage',
        title: 'Data leakage: cuando el training conoce el futuro',
        titleEn: 'Data leakage',
        priority: 'core',
        dims: ['monitoreo', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Data leakage es que el entrenamiento o la evaluación tengan información que no existirá al momento de predecir, o que el test se parezca demasiado al train. El síntoma es siempre el mismo: una métrica offline sospechosamente buena que se derrumba en producción. No es lo mismo que el skew: en el skew, la misma información se calcula distinto; en el leakage, hay información que no debería estar.` },
          { t: 'h3', text: 'Leakage temporal: el label se cuela en una feature' },
          { t: 'p', html: `Un modelo de fraude usa la feature "contracargos de la tarjeta en los últimos 90 días". Para armar el dataset, alguien la calcula hoy, sobre la tabla de contracargos actual, para todas las transacciones históricas. Una transacción fraudulenta del 1 de septiembre cuyo contracargo llegó el 20 de septiembre queda con la feature en ≥ 1: <b>su propio label</b> está contado en ella. El modelo aprende "si hay contracargos, es fraude" y en offline se ve casi perfecto; en producción, al momento de decidir, ese contracargo todavía no existe.` },
          { t: 'table', caption: 'Tres transacciones de la misma tarjeta, dos formas de calcular la feature', head: ['Transacción', 'Contracargo llegó', 'Feature calculada hoy', 'Feature a la hora de la decisión'], rows: [
            ['1 sep., fraude', '20 sep.', '1 (cuenta el suyo)', '0'],
            ['3 sep., legítima', '—', '1 (cuenta el del 1 sep., que llegó después)', '0'],
            ['25 sep., legítima', '—', '1', '1 (el contracargo del 20 ya existía)'],
          ] },
          { t: 'p', html: `Solo la última fila es información legítima. Las dos formas de este error: <b>features post-evento</b> (campos que se actualizan después: "cuenta bloqueada", "publicación re-categorizada por un moderador", "estado final del pedido") y <b>agregados calculados con la fecha equivocada</b> (el <code>now()</code> de la <a href="#m09.pipelines">sección 2</a>). La defensa es la misma del feature store: cada feature con el valor que tenía cuando se decidió, y los labels, que llegan tarde, unidos por evento (<i>delayed labels</i>: <a href="#m12.modelo">M12</a>).` },
          { t: 'list', items: [
            '<b>Estadísticas ajustadas con todo el dataset</b>: media y desviación para normalizar, vocabularios o target encoding calculados antes del split. Se calculan solo con train.',
            '<b>Umbrales elegidos sobre el set donde reportas</b>: si eliges el punto de operación en el golden set y reportas el recall en el mismo set, el número sale optimista. c03 elige umbrales en validación y certifica recall con defectos de fuentes independientes (<a href="#c03.evaluacion">c03</a>).',
            '<b>Selección de modelo sobre el test</b>: probar 40 variantes y reportar la mejor en test convierte el test en validación.',
          ] },
          { t: 'h3', text: 'Split por tiempo y por entidad' },
          { t: 'table', head: ['Split', 'Cuándo', 'Qué evita', 'En los casos'], rows: [
            ['Aleatorio por ejemplo', 'Solo si los ejemplos son de verdad independientes (casi nunca en producción)', '—', 'Ninguno de los tres'],
            ['Temporal', 'Siempre que el modelo predice el futuro. Regla 33 de Zinkevich: si entrenas con datos hasta el 5 de enero, evalúa desde el 6', 'Usar el futuro para predecir el pasado; tendencias que el modelo "ya conoce"', 'c03: por tiempo o por lote'],
            ['Por entidad (grupo)', 'Cuando muchos ejemplos vienen de la misma fuente: vendedor, cámara, lote, paciente', 'Memorizar la entidad (el fondo del vendedor, el ángulo de la cámara) en vez de aprender la tarea', 'c01: por vendedor; c02: por cámara'],
            ['Temporal + entidad', 'Cuando en producción llegarán entidades nuevas en el futuro', 'Sobrestimar cómo te irá con un sitio o un cliente que el modelo nunca vio', 'c02 parte por cámara y fecha; para estimar un sitio nuevo antes de su shadow, sumarías sitios enteros fuera del train'],
          ] },
          { t: 'h3', text: 'En visión: duplicados y casi duplicados' },
          { t: 'p', html: `Hasta los benchmarks académicos lo tienen: Barz y Denzler (<i>Do We Train on Test Data? Purging CIFAR of Near-Duplicates</i>, 2020) encontraron que el 3.3 % de las imágenes de test de CIFAR-10 y el 10 % de las de CIFAR-100 tienen un casi duplicado en train. En producción es peor, porque los datos vienen en ráfagas.` },
          { t: 'calc', title: 'c02: un split aleatorio de frames', rows: [
            { label: 'Frames de un evento de 10 s a 5 fps', expr: '10 s × 5 fps', value: '50 frames casi idénticos' },
            { label: 'Probabilidad de que los 50 caigan en train (80/20)', expr: '0.8<sup>50</sup>', value: '≈ 0.0014 %' },
            { label: 'Probabilidad de que los 50 caigan en test', expr: '0.2<sup>50</sup>', value: '≈ 0' },
            { label: 'Eventos con frames en train y en test', expr: '1 − 0.8<sup>50</sup> − 0.2<sup>50</sup>', value: '≈ 99.999 %' },
          ], result: 'Con un split aleatorio por frame, prácticamente cada evento del test tiene gemelos en train: estás midiendo memoria, no generalización. Por eso c02 parte por cámara y por fecha, y c03 por tiempo o por lote.' },
          { t: 'table', head: ['Caso', 'De dónde salen los gemelos', 'Split', 'Dedupe'], rows: [
            ['<a href="#c01.datos">c01</a>', 'La misma foto en tres publicaciones; un vendedor fotografía todo sobre la misma mesa', 'Por vendedor', 'sha256 para copias exactas; hash perceptual (pHash) o similitud de embeddings para recortes y recompresiones'],
            ['<a href="#c02.datos">c02</a>', 'Frames consecutivos; la misma escena cada noche', 'Por cámara y fecha (y sitios enteros aparte si quieres estimar un sitio nuevo)', 'Casi duplicados por embedding dentro de cada evento'],
            ['<a href="#c03.datos">c03</a>', 'Piezas consecutivas del mismo lote con la misma luz', 'Por tiempo o por lote', 'Por hash; un lote entero va a un solo lado'],
          ] },
          { t: 'callout', kind: 'trap', title: 'El atajo por la fuente', html: `<p>Si los positivos y los negativos vienen de fuentes distintas, el modelo aprende la fuente. Ejemplo: los defectos de c03 se fotografían en la mesa de inspección manual (otra luz, otro fondo) y las piezas buenas en la línea; el modelo aprende "luz de la mesa = defecto" y el test, armado igual, lo confirma. Lo mismo si los hard negatives de c02 vienen todos de la cámara con telarañas. La prueba rápida: entrena un modelo trivial solo con metadatos (cámara, fuente, hora, estación). Si predice el label bastante mejor que el azar, tus datos tienen un atajo que el modelo real también va a encontrar.</p>` },
          { t: 'callout', kind: 'why', title: 'Por qué el entrevistador insiste aquí', html: `<p>Porque un leakage no se ve en ningún dashboard hasta que llega a producción, y porque es la pregunta que distingue a quien leyó sobre splits de quien tuvo que explicar por qué el modelo con 99 % offline no funcionó. La señal que busca: que digas la unidad del split antes de que te pregunten, y que desconfíes en voz alta de una métrica demasiado buena.</p>` },
          { t: 'followups', items: [
            { q: 'Tu modelo de fraude tiene AUC 0.99 offline. ¿Qué haces?',
              junior: 'Lo despliego: es un modelo excelente.',
              senior: `Desconfío antes de celebrar. Reviso la importancia de features buscando una que domine; para cada una, pregunto si existía en el instante de la decisión (contracargos, estados que se actualizan después). Verifico que el dataset se armó con un join point-in-time y que el split es temporal. Y entreno un modelo solo con la feature sospechosa: si él solo da 0.95, encontré el leak.`,
              why: 'Trata la métrica perfecta como un síntoma y tiene un procedimiento concreto para encontrar la causa.' },
            { q: '¿Cómo partes train y test en c01?',
              junior: '80/20 aleatorio, estratificado por categoría.',
              senior: `Por vendedor, con un hash del <code>seller_id</code>, después de deduplicar por sha256 y por hash perceptual: un mismo vendedor fotografía todo con el mismo fondo y la misma luz, y la misma foto aparece en varias publicaciones. Estratifico por categoría dentro de esa restricción. El golden set es aparte, congelado y etiquetado por humanos, y para medir el futuro evalúo también con publicaciones posteriores a la fecha de corte.`,
              why: 'Nombra la unidad del split, el dedupe y la dimensión temporal: las tres fuentes de leakage del caso.' },
            { q: 'Offline dio 85 % y online se comporta como un modelo de 80 %. ¿Qué miras primero?',
              junior: 'Reentreno con datos más recientes: es drift.',
              senior: `Primero separo skew de drift. Paso imágenes de referencia por el gateway real y comparo con el pipeline de evaluación; si difieren, es skew (decode, resize, RGB/BGR, EXIF, versión de Pillow) y se arregla en el código. Si coinciden, miro si el tráfico cambió respecto del golden set: mezcla de móvil y web, categorías nuevas. Y reviso el leakage del lado offline: duplicados entre golden set y train inflarían el 85 %.`,
              why: 'Tiene tres hipótesis ordenadas por costo de verificación y sabe cuál se arregla con código y cuál con datos.' },
            { q: 'Se agregan 5 sitios nuevos en c02. ¿Cómo estimas cómo le irá al modelo ahí?',
              junior: 'Con el recall del test set actual.',
              senior: `El test actual tiene cámaras que el modelo ya vio en train (otras fechas, mismas escenas): sobreestima. Hago un split por sitio (dejo sitios enteros fuera del entrenamiento) para estimar el desempeño en un sitio nuevo, y reporto la dispersión entre sitios, no solo el promedio. En la práctica, los sitios nuevos entran en shadow con su propio slice desde la primera semana, y ahí mido de verdad.`,
              why: 'Reconoce que la unidad de generalización cambió y ajusta el split a la pregunta.' },
            { q: 'Tu training set sale de un join con la tabla de usuarios. ¿Algún problema?',
              junior: 'No, es un join normal por <code>user_id</code>.',
              senior: `La tabla de usuarios es el estado de hoy: país, plan, "cuenta verificada" pueden haber cambiado después de cada evento. Es la regla 31 de Zinkevich. Uso un snapshot de la dimensión por fecha (o una tabla con historial de cambios) y hago el join as-of, o me quedo solo con atributos que no cambian.`,
              why: 'Ve el leakage escondido en un join que parece inocente y conoce la herramienta (historial + as-of).' },
            { q: '¿Cómo sabes que tus labels no tienen un atajo?',
              junior: 'Los revisamos a mano.',
              senior: `Entreno un modelo trivial solo con metadatos (cámara, fuente, hora, sitio) contra el label. Si predice mucho mejor que el azar, hay un atajo: positivos y negativos vienen de fuentes distintas. Luego reviso ejemplos por slice y arreglo la recolección, por ejemplo fotografiando los defectos en la misma estación que las piezas buenas.`,
              why: 'Convierte una sospecha vaga en una prueba barata y reproducible.' },
          ] },
          { t: 'callout', kind: 'interview', html: `<ul><li>"I split by seller and by time, after deduplicating by hash, because the same photo and the same background show up across listings."</li><li>"A 0.99 AUC makes me suspicious first: I check that every feature existed at decision time and that the join is point-in-time."</li></ul>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'versionado',
        title: 'Versionado de datos y snapshots inmutables',
        titleEn: 'Data versioning and immutable snapshots',
        priority: 'core',
        dims: ['arquitectura', 'monitoreo'],
        blocks: [
          { t: 'p', html: `Git versiona tu código; nada versiona tus datos a menos que lo diseñes. Y las preguntas que llegan en producción son de datos: "¿con qué datos se entrenó el modelo de agosto?", "la métrica bajó, ¿cambió el código o cambiaron los datos?", "esta imagen que un usuario pidió borrar, ¿en qué datasets y modelos está?" (<a href="#c01.datos">c01</a>), "la armadora encontró una fisura en el lote X, ¿qué vio el sistema?" (<a href="#c03.datos">c03</a>). Sin versionado, la respuesta honesta es "no sabemos".` },
          { t: 'p', html: `La unidad es un <b>snapshot inmutable</b>: un id (<code>ds-2026-09-01</code>), un manifest que lista cada ejemplo (hash, ruta, label, fuente del label, fecha) y la regla con que se armó. Se escribe una vez y nunca se edita; un cambio es un snapshot nuevo. Cada modelo registrado guarda tres punteros: snapshot de datos, commit de código y digest del contenedor de entrenamiento. Cómo eso da reproducibilidad es <a href="#m10.reproducibilidad">M10</a>.` },
          { t: 'code', title: 'La tarjeta de un snapshot de c01', caption: 'Un ejemplo de metadatos junto al manifest (JSON válido). El manifest en sí es un Parquet con una fila por imagen.', files: [
            { name: 'snapshot.json', lang: 'json', code: MANIFEST },
          ] },
          { t: 'calc', title: 'Por qué un snapshot de imágenes es barato', rows: [
            { label: 'Imágenes del training set', expr: '', value: E('≈ 2 M') },
            { label: 'Imágenes que el manifest referencia (no copia)', expr: '2 M × ' + E('≈ 200 KB'), value: '≈ 400 GB en el storage del producto; solo las etiquetadas por humanos y el golden set viven en el bucket restringido' },
            { label: 'Manifest (hash, ruta, label, fuente, vendedor, fecha)', expr: '2 M × ' + E('≈ 200 B') + ' por fila, sin comprimir', value: '≈ 400 MB' },
            { label: 'Costo de un snapshot nuevo', expr: '400 MB / 400 GB', value: '≈ 0.1 % de las imágenes' },
          ], result: 'Un snapshot es solo un manifest de keys y sha256: no copia imágenes, así que puedes tener uno por mes durante años. En c01 las fotos con label del vendedor siguen en el storage del producto (con su política de borrado) y solo las ≈ 5k/mes etiquetadas y el golden set se copian, sin EXIF, a un bucket restringido. El sha256 del manifest detecta si una foto cambió o se borró.' },
          { t: 'table', caption: 'Cuatro formas de versionar datos', head: ['Opción', 'Qué es', 'Bueno para', 'Cuidado'], rows: [
            ['<b>Prefijos inmutables + manifest</b>', '<code>s3://…/datasets/ds-2026-09-01/</code> con el manifest en Parquet, y object lock o una política que prohíba sobrescribir', 'Datasets de imágenes; lo más simple; la elección de c01', 'Es una convención: sin la política de no-sobrescribir, alguien la rompe'],
            ['<b>DVC</b>', 'Archivos <code>.dvc</code> con hashes en git; los datos en un remote (S3, GCS); pipelines con <code>dvc repro</code>', 'Un equipo chico con datasets de archivos de tamaño moderado, todo junto al código', 'Con millones de archivos chicos se vuelve lento'],
            ['<b>lakeFS</b>', 'Branches, commits y merges sobre el object storage, con API compatible con S3; los branches no copian datos', 'Un lake grande; probar un cambio en un branch y publicarlo solo si pasa la validación (write-audit-publish: escribir aislado, auditar, publicar)', 'Un servicio más que operar, o uno administrado que pagar. Desde v1.87.0 (22-sep-2026) es Business Source License 1.1: según su licencia, el uso productivo interno sin modificar está permitido, pero no ofrecerlo como servicio a terceros (<a href="#ref-herramientas.datos-features">herramientas</a>)'],
            ['<b>Delta Lake / Iceberg (time travel)</b>', 'Cada escritura crea una versión; <code>VERSION AS OF</code> o <code>TIMESTAMP AS OF</code> leen el pasado', 'Tablas: features, logs de predicciones, manifests', 'La retención borra el pasado (trampa abajo)'],
          ] },
          { t: 'callout', kind: 'trap', title: 'Time travel no es un archivo', html: `<p>En Delta Lake, por defecto, el historial del log dura 30 días y <code>VACUUM</code> puede borrar los archivos de versiones viejas pasados 7 (<code>delta.deletedFileRetentionDuration</code>). En Iceberg, <code>expire_snapshots</code> borra por defecto los snapshots de más de 5 días cuando corre. "El modelo de marzo se entrenó con la versión 1,234 de la tabla" deja de ser reproducible en cuanto corre el mantenimiento. Para lo que tiene que durar: en Iceberg, un tag con retención (<code>ALTER TABLE … CREATE TAG &#96;ds-2026-09-01&#96; RETAIN 365 DAYS</code>, y luego <code>VERSION AS OF 'ds-2026-09-01'</code>); en Delta, subir la retención de esa tabla o materializar el snapshot aparte.</p>` },
          { t: 'callout', kind: 'senior', html: `<p>Guarda los labels como <b>eventos</b> que nunca se sobrescriben (autor, hora, fuente, versión de la guía), como hace c03 con los veredictos del inspector. Un snapshot es entonces una consulta "todos los labels vigentes a tal fecha": reproducible, auditable, y con point-in-time también para los labels, que llegan tarde. Corregir un label es agregar uno nuevo que lo reemplaza, no editar una fila.</p>` },
          { t: 'callout', kind: 'note', title: 'Inmutable no significa eterno', html: `<p>Las leyes de protección de datos pueden obligarte a borrar una imagen (en México, la LFPDPPP; los detalles los define el equipo legal). Diséñalo desde el inicio: imágenes por hash con una lista de borrado, snapshots con retención definida y un índice que diga qué snapshots y qué modelos tocó cada imagen. Si un modelo se entrenó con datos que hubo que borrar, la política (reentrenar o no, y cuándo) es una decisión explícita, no un descubrimiento.</p>` },
          { t: 'callout', kind: 'skip', html: `<p>Los comandos de DVC o de lakeFS no se preguntan. Lo que se evalúa es que digas "snapshot inmutable con id, manifest, y el modelo apunta a él" y sepas elegir entre prefijos + manifest (imágenes) y una tabla con time travel (datos tabulares) sabiendo su retención.</p>` },
          { t: 'callout', kind: 'interview', html: `<ul><li>"Every training set is an immutable snapshot with an ID and a manifest, and each registered model points to its snapshot, its commit and its container digest."</li><li>"A snapshot references images by key and hash instead of copying them, so a new snapshot is just a manifest; that makes monthly snapshots almost free."</li></ul>` },
        ],
      },

      // ======================================================== 7
      {
        id: 'etiquetado',
        title: 'Etiquetado: guías, calidad, costo y active learning',
        titleEn: 'Labeling, label quality and active learning',
        priority: 'core',
        dims: ['arquitectura', 'estimaciones', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `El label es el dato más caro por unidad y el techo de todo lo demás: un modelo no puede ser más consistente que las personas que le enseñaron, y un golden set con labels ruidosos no puede certificar nada. En los tres casos, el dinero del etiquetado se gasta mejor decidiendo <b>qué</b> etiquetar que comprando más GPU.` },
          { t: 'h3', text: 'La guía de etiquetado' },
          { t: 'list', items: [
            '<b>Definición operativa de cada clase</b>, con ejemplos y <b>contraejemplos</b>. "Rebaba: material sobrante en el borde" no alcanza; hace falta la foto de una rebaba que cuenta y la de una marca de herramienta que no.',
            '<b>Casos límite decididos por escrito</b>: ¿una persona a medio cuerpo detrás de un montacargas cuenta? (<a href="#c02.datos">c02</a>). ¿Un celular con funda va en "celulares" o en "fundas"? Cada desacuerdo resuelto entra a la guía.',
            '<b>Una salida para "no sé" u "otro"</b>: obligar a elegir produce labels inventados. En c03, "otro" acumulado con el mismo aspecto es un candidato a tipo nuevo.',
            '<b>Versionada</b>: cada label guarda la versión de la guía con que se hizo. Si la definición cambia, sabes qué labels revisar.',
          ] },
          { t: 'h3', text: 'Calidad: preguntas de control, doble anotación y acuerdo' },
          { t: 'list', items: [
            '<b>Gold questions</b>: ejemplos con respuesta conocida mezclados en la cola, sin que el anotador sepa cuáles son. Miden la exactitud de cada anotador y detectan a quien responde al azar.',
            '<b>Doble anotación parcial</b>: ≈ 10 % de los ejemplos los etiquetan dos personas (c01, c02). Mide el acuerdo; los desacuerdos van a un experto que decide (adjudicación) y a la guía.',
            '<b>Revisión por un experto</b> de todos los desacuerdos con el modelo y de una muestra aleatoria (c03: calidad revisa ≈ 5 % de los veredictos del inspector).',
          ] },
          { t: 'p', html: `El porcentaje de acuerdo engaña cuando una clase domina. Dos inspectores de c03 revisan las mismas 1,000 piezas cerca del umbral: casi todas buenas, pocas con defecto.` },
          { t: 'calc', title: "Cohen's kappa: 97 % de acuerdo que no vale tanto", rows: [
            { label: 'Ambos "buena" / ambos "defecto"', expr: '', value: '960 / 10' },
            { label: 'Desacuerdos (A dice defecto y B no, y al revés)', expr: '', value: '15 / 15' },
            { label: 'Acuerdo observado', expr: 'p<sub>o</sub> = (960 + 10) / 1,000', value: '0.97' },
            { label: 'Cada uno marca defecto en', expr: '(10 + 15) / 1,000', value: '2.5 %' },
            { label: 'Acuerdo esperado por azar', expr: 'p<sub>e</sub> = 0.025 × 0.025 + 0.975 × 0.975', value: '≈ 0.951' },
            { label: 'Kappa', expr: 'κ = (p<sub>o</sub> − p<sub>e</sub>) / (1 − p<sub>e</sub>) = 0.019 / 0.049', value: '≈ 0.38' },
            { label: 'Acuerdo en los defectos', expr: '2 × 10 / (2 × 10 + 15 + 15)', value: '0.40' },
            { label: 'Tras aclarar la guía: 970 / 20 / 5 / 5', expr: 'p<sub>o</sub> = 0.99, mismo p<sub>e</sub>', value: 'κ ≈ 0.79' },
          ], result: 'Con 97 % de acuerdo, los inspectores coinciden en solo 10 de 40 piezas que alguno marcó como defecto: justo la clase que importa. Dos puntos más de acuerdo bruto duplican kappa. Reporta kappa (o el acuerdo en la clase rara), no el porcentaje. Calculado con <code>sklearn.metrics.cohen_kappa_score</code>; da lo mismo que a mano.' },
          { t: 'p', html: `Una escala muy citada (Landis y Koch, 1977) llama "moderado" a 0.41–0.60, "sustancial" a 0.61–0.80 y "casi perfecto" a más de 0.80. Es una convención, no una ley: para un golden set que certifica un recall de 99.5 %, un kappa de 0.6 en la clase de defecto significa que la guía todavía no está lista. Y la consecuencia de diseño: si dos humanos no coinciden, el modelo no puede aprender la frontera ni tú medirla.` },
          { t: 'callout', kind: 'skip', html: `<p>Con más de dos anotadores por ejemplo se usan Fleiss' kappa o Krippendorff's alpha. Basta con nombrarlos; la intuición es la de Cohen: acuerdo corregido por el que se daría al azar.</p>` },
          { t: 'callout', kind: 'trap', title: 'La herramienta no calcula el acuerdo por ti', html: `<p>Label Studio Community (open source) te da la interfaz de etiquetado y los proyectos, pero la configuración de overlap (cuántos anotadores por ejemplo), marcar ground truth para las preguntas de control y las métricas de acuerdo son de las ediciones pagas (limitadas en Starter Cloud, completas en Enterprise). Si tu herramienta no reporta kappa, exporta las anotaciones y calcúlalo tú con scikit-learn.</p>` },
          { t: 'h3', text: 'Costo y throughput' },
          { t: 'calc', title: 'c01: la cola mensual y el golden set', rows: [
            { label: 'Imágenes al mes + 10 % con doble anotación', expr: '5,000 × 1.1', value: '5,500 anotaciones' },
            { label: 'Tiempo por anotación (500 categorías, con sugerencias)', expr: 'mídelo con un piloto', value: E('≈ 20–30 s') },
            { label: 'Horas de anotación al mes', expr: '5,500 × 20–30 s', value: '≈ 31–46 h' },
            { label: 'Costo al mes', expr: '5,000 imágenes × ' + E('US$0.05–0.10') + ' (la doble anotación suma ≈ 10 %)', value: E('≈ US$250–500 (+≈ US$25–50)') },
            { label: 'Golden set: 50k imágenes, todas con doble anotación', expr: '100,000 × 20–30 s', value: '≈ 560–830 h' },
            { label: 'Costo único del golden set', expr: '50,000 imágenes × 2 anotaciones × ' + E('US$0.05–0.10'), value: E('≈ US$5–10k') },
          ], result: 'La cola mensual es menos de media persona; el golden set es un proyecto de ≈ 3.5–5 personas-mes que se hace una vez y se cuida. Por eso se congela, se versiona y nunca se usa para entrenar. Los precios por label varían mucho por tarea y proveedor: pide cotización con un piloto.' },
          { t: 'calc', title: 'c03: el label dentro del trabajo del inspector', rows: [
            { label: 'Piezas desviadas por línea al día', expr: 'de <a href="#c03.datos">c03</a>', value: '≈ 2,292' },
            { label: 'Un toque en la tablet por pieza', expr: '2,292 × ' + E('≈ 2 s'), value: '≈ 1.3 h/día por línea' },
            { label: 'Labels al día en la planta', expr: '2,292 × 4 líneas', value: '≈ 9,200' },
            { label: 'Revisión de calidad (5 %)', expr: '9,200 × 0.05', value: '≈ 460 al día' },
          ], result: 'La planta produce en un día más labels que c01 en un mes, casi gratis, porque el label vive dentro de un trabajo que el inspector ya hace. El precio es el sesgo: solo ve lo que el modelo desvió (abajo).' },
          { t: 'table', caption: '¿Quién etiqueta?', head: ['Opción', 'Cuándo', 'A favor', 'Riesgo'], rows: [
            ['Proveedor o crowd', 'Tareas genéricas con guía clara y volumen', 'Escala rápido; pagas por label', 'Poco contexto de dominio; privacidad (video de c02, imágenes médicas de <a href="#c04">c04</a>)'],
            ['Equipo propio', 'Dominio con matices, datos sensibles', 'Control, feedback directo a la guía', 'Costo fijo; se vuelve cuello de botella'],
            ['Expertos', 'Casos ambiguos, adjudicación, golden set', 'La mejor calidad', 'Caros y escasos: úsalos donde el label es difícil, no en volumen'],
            ['Dentro del flujo de trabajo', 'Alguien ya decide sobre el ejemplo: moderadores (c01), SOC (c02), inspectores (c03)', 'Volumen casi gratis y rápido', 'Sesgo de selección y de anclaje: solo ve lo que el sistema le muestra'],
          ] },
          { t: 'h3', text: 'Ruido en los labels' },
          { t: 'p', html: `Northcutt, Athalye y Mueller (<i>Pervasive Label Errors in Test Sets Destabilize Machine Learning Benchmarks</i>, NeurIPS 2021) estimaron en promedio al menos 3.3 % de labels erróneos en los test sets de 10 datasets conocidos, y ≈ 6 % en la validación de ImageNet. Si los benchmarks tienen eso, tu dataset también. Consecuencias: un techo en la accuracy que puedes medir, y comparaciones del gate que se mueven por labels mal puestos. Qué hacer: marcar sospechosos (ejemplos donde el modelo discrepa con mucha confianza, o técnicas como <i>confident learning</i>, implementada en la librería cleanlab) y mandarlos a <b>revisión humana</b>, no borrarlos automáticamente: un "error" seguro del modelo puede ser justo el caso difícil que necesitas.` },
          { t: 'h3', text: 'Active learning y human in the loop' },
          { t: 'table', head: ['Estrategia', 'Qué elige', 'Riesgo', 'En los casos'], rows: [
            ['Incertidumbre', 'Menor confianza, menor margen entre la 1.ª y la 2.ª clase, mayor entropía', 'Se llena de ruido y de casos imposibles; ignora lo que el modelo cree saber y hace mal', 'c01: top-1 &lt; 0.3 o margen chico'],
            ['Diversidad', 'Ejemplos que cubren el espacio (clusters de embeddings, core-set)', 'Más cómputo para elegir', 'Evita 500 fotos casi iguales de la misma cámara (c02)'],
            ['Desacuerdo', 'Donde el modelo y un humano (o dos modelos) no coinciden', 'Sesgado a lo que el sistema ya mostró', 'c01: el vendedor eligió fuera del top-5; c02: el verificador descartó lo que el edge marcó'],
            ['Cerca del umbral', 'Lo que casi cambió de decisión', 'Solo ve los alrededores del punto de operación', 'c03: los casi-rechazos, donde viven los escapes'],
            ['Aleatoria', 'Una muestra del tráfico real', 'Poco informativa por label', '20–30 % del presupuesto en c01 y c02: es lo único que estima el error real'],
          ] },
          { t: 'callout', kind: 'trap', title: 'Evaluar con lo que eligió el active learning', html: `<p>Un set armado con los ejemplos más inciertos es, a propósito, más difícil que el tráfico real: la accuracy medida ahí sale más baja de lo que ven los usuarios, y la de un set armado con desacuerdos, sesgada hacia los errores que el sistema ya mostraba. Entrena con lo que eligió el active learning; <b>evalúa</b> con el golden set y con la muestra aleatoria. Y si dejas la muestra aleatoria afuera para ahorrar, pierdes la única forma de saber cuánto se equivoca el sistema de verdad.</p>` },
          { t: 'p', html: `Los tres casos cierran el loop con humanos de formas distintas: en <a href="#c01.datos">c01</a>, una cola de ≈ 5k imágenes al mes elegidas por incertidumbre, desacuerdo y azar, más las correcciones de moderadores; en <a href="#c02.datos">c02</a>, los veredictos del SOC dicen qué evento fue falso y un anotador dibuja las cajas en una muestra; en <a href="#c03.datos">c03</a>, el inspector etiqueta con un toque lo que ya está revisando, y en ≈ 10 % de las piezas la tablet oculta el motivo del modelo para medir el <b>sesgo de anclaje</b>.` },
          { t: 'h3', text: 'Labels débiles e implícitos' },
          { t: 'table', head: ['Fuente', 'Qué sesgo trae', 'Cómo se usa'], rows: [
            ['Categoría final del vendedor (c01)', 'Feedback loop: tiende a aceptar tu primera sugerencia', 'Filtrada con señales de confianza, para entrenar; nunca como única evaluación. Un holdout de ≈ 1 % de vendedores sin sugerencias da labels no contaminados'],
            ['Veredicto del SOC (c02)', 'Solo existe para lo que disparó una alerta; es de evento, no de caja; "persona autorizada" no es un error del detector', 'Métrica de precisión online y fuente de hard negatives, con un motivo que separe modelo de regla'],
            ['Veredicto del inspector (c03)', 'Solo ve piezas desviadas; anclaje en lo que dijo el modelo', 'Entrenamiento; el recall se certifica con defectos de fuentes independientes'],
            ['Clicks (<a href="#c08">c08</a>)', 'Sesgo de posición: se hace click en lo que está arriba', 'Con corrección de posición y exploración; se ve en c08'],
          ] },
          { t: 'callout', kind: 'senior', html: `<p>Por cada fuente de labels, di en una frase qué sesgo trae y qué fuente independiente usas para evaluar. Es lo que el entrevistador anota como "entiende los datos". El holdout sin sugerencias de c01 es el ejemplo perfecto: cuesta 1 % del tráfico sin el beneficio del modelo y te da los únicos labels que el modelo no influyó, además de medir su valor incremental.</p>` },
          { t: 'callout', kind: 'interview', html: `<ul><li>"About ten percent of the queue is double-labeled; we track Cohen's kappa per class, because raw agreement looks great when one class dominates."</li><li>"The labeling budget goes to uncertain examples, disagreements and a random slice; we train on all of it but evaluate only on the golden set and the random slice."</li></ul>` },
        ],
      },

      // ======================================================== 8
      {
        id: 'validacion-datos',
        title: 'Validación de datos: schemas y expectativas',
        titleEn: 'Data validation',
        priority: 'core',
        dims: ['monitoreo', 'arquitectura'],
        blocks: [
          { t: 'p', html: `El equipo que produce una tabla renombra una columna, cambia centímetros por milímetros o su job escribe la mitad de las filas. Nada falla: tu pipeline lee lo que hay, entrena, y en el mejor caso el gate atrapa un modelo peor; en el peor, el gate no lo atrapa porque el golden set no tiene el caso. La validación de datos es el contrato con tus fuentes, escrito como código y ejecutado en cada partición, antes de que los datos lleguen al modelo.` },
          { t: 'table', caption: 'Qué se valida', head: ['Tipo', 'Ejemplo (c01 o c03)', 'Por qué'], rows: [
            ['Schema', 'Columnas esperadas, tipos, sin columnas extra (<code>strict</code>)', 'Un rename o un tipo nuevo rompe todo lo que viene después'],
            ['Rangos y dominios', '<code>label_id</code> en 0–499; ancho ≥ 64 px; <code>label_source</code> en una lista cerrada', 'Atrapa unidades cambiadas, ids corridos, valores imposibles'],
            ['Nulos', '% de nulos por columna ≤ el histórico + margen', 'Un join que dejó de encontrar filas se ve como nulos, no como error'],
            ['Unicidad', 'sha256 único en el snapshot; ninguna imagen en train y en test a la vez', 'Duplicados inflan pesos y métricas (<a href="#m09.leakage">sección 5</a>)'],
            ['Distribución', 'Proporción por categoría o por fuente de label vs el snapshot anterior (PSI)', 'Un cambio semántico que pasa el schema'],
            ['Frescura', 'El dato más nuevo tiene menos de 48 h', 'Un upstream caído deja de mandar y todo parece normal'],
            ['Volumen', 'Filas entre 0.8× y 1.5× del snapshot anterior', 'Un job que murió a la mitad o una fuente que se duplicó'],
            ['Integridad referencial', 'Cada fila del manifest tiene su imagen en storage; cada label, su predicción', 'Filas huérfanas fallan tarde, a mitad del entrenamiento'],
          ] },
          { t: 'h3', text: 'Dónde van los chequeos' },
          { t: 'table', head: ['Dónde', 'Qué valida', 'Si falla'], rows: [
            ['Ingesta (frontera con cada fuente)', 'Schema, nulos, volumen y frescura de cada partición que llega', 'La partición va a cuarentena y se alerta al dueño de la fuente; lo de abajo no corre. Es write-audit-publish: se escribe aislada y se publica solo si pasa'],
            ['Antes de entrenar (el snapshot)', 'Todo lo anterior más duplicados, split, mezcla de fuentes de label, distribución vs snapshot anterior', 'No hay entrenamiento; el champion sigue sirviendo'],
            ['En serving (cada request)', 'El input: la imagen decodifica, tipo y tamaño (c01 responde 400, 413 o 415); features en rango y frescas', 'Fallback o valor por defecto, más una métrica; nunca un 500 sin explicación'],
            ['Después de entrenar', 'El modelo, no los datos: golden set, slices, parity', 'Es el gate de <a href="#m10.gate">M10</a>'],
          ] },
          { t: 'h3', text: 'Bloquear o avisar' },
          { t: 'p', html: `No todo chequeo debe detener el pipeline. <b>Bloquea</b> lo que invalida el resultado sin discusión: schema roto, labels fuera de rango, duplicados entre splits, volumen a la mitad, datos de hace una semana. <b>Avisa</b> lo que merece mirada humana pero puede ser real: una categoría que creció 30 % (quizá es temporada), un slice que quedó más chico. Un chequeo nuevo empieza como aviso; cuando ves que su tasa de falsas alarmas es baja, lo promueves a bloqueo. Un pipeline que bloquea por ruido cada semana termina con alguien que desactiva la validación.` },
          { t: 'code', title: 'Validar un snapshot de c01 antes de entrenar', caption: 'Corrió con pandas 3.0.6 y Pandera 0.33.1, llamando con <code>now = pd.Timestamp.now(tz="UTC")</code>: un snapshot sano pasa sin errores; los casos rotos dan la salida de la segunda pestaña. Si falta una columna, devuelve el error de schema y no sigue.', files: [
            { name: 'validate_snapshot.py', lang: 'python', code: VALIDATE_CODE },
            { name: 'salida.txt', lang: 'text', code: VALIDATE_OUT, note: 'Un snapshot con un sha256 duplicado, un <code>label_id</code> de 600 y 85 % de labels débiles; otro con la mitad de filas y 3 días de atraso; otro con timestamps sin zona.' },
          ] },
          { t: 'list', items: [
            '<b><code>lazy=True</code></b> junta todas las fallas en vez de parar en la primera: un reporte completo le ahorra al dueño de la fuente cinco idas y vueltas.',
            '<b>El schema no alcanza.</b> Volumen, frescura y mezcla de fuentes se comparan contra el snapshot anterior: son relativos y el schema no los ve.',
            '<b>La zona horaria es parte del contrato</b>: un timestamp sin zona es la causa de skew de la <a href="#m09.skew">sección 4</a>, detectado antes de entrenar.',
            '<b>Los umbrales son del equipo</b>: 0.8–1.5× y 80 % son ejemplos; se fijan mirando la historia de tus snapshots.',
          ] },
          { t: 'table', caption: 'Herramientas (versiones de septiembre de 2026)', head: ['Herramienta', 'Qué es', 'Cuándo'], rows: [
            ['Great Expectations (GX Core 1.x)', 'Expectations declarativas, checkpoints y reportes (Data Docs) sobre pandas, Spark o SQL', 'Varios equipos y fuentes, reportes legibles para gente que no programa'],
            ['Pandera', 'Schemas en Python para pandas, Polars y PySpark; liviano', 'Validación dentro del código del pipeline y en tests unitarios'],
            ['TFDV (TensorFlow Data Validation)', 'Estadísticas, schema inferido, anomalías y comparadores de skew y drift', 'Si ya estás en TFX o TensorFlow; arrastra esa dependencia'],
            ['Deequ / PyDeequ', 'Chequeos y "unit tests" de datos sobre Spark (AWS Labs)', 'Tablas grandes que ya procesas con Spark'],
            ['Tests de dbt', 'Tests de SQL (not null, unique, relaciones) en el warehouse', 'Si la transformación ya vive en dbt'],
          ] },
          { t: 'callout', kind: 'trap', title: 'Validar solo el schema', html: `<p>El cambio de centímetros a milímetros pasa cualquier validación de schema: sigue siendo un float, sin nulos, en la misma columna. Lo atrapa un rango (la altura de una pieza no mide 3,000) o una comparación de distribución contra el snapshot anterior. La mayoría de los incidentes de datos son semánticos, no de formato.</p>` },
          { t: 'callout', kind: 'senior', html: `<p>Pon la validación del lado del productor también: si el equipo dueño de la tabla corre tu contrato en su CI, el cambio incompatible falla en su pull request y no a las 3 a. m. en tu pipeline. Y separa responsabilidades: la validación de datos mira los datos; el gate de <a href="#m10.gate">M10</a> mira el modelo; el monitoreo de <a href="#m12">M12</a> mira producción. Los tres hacen falta.</p>` },
          { t: 'callout', kind: 'interview', html: `<ul><li>"Every snapshot is validated before training: schema, ranges, duplicates, freshness and volume against the previous one. If a blocking check fails, we don't train and the champion keeps serving."</li><li>"New checks start as warnings and get promoted to blocking once we know their false-alarm rate."</li></ul>` },
          { t: 'callout', kind: 'connect', html: `<p>La validación que ocurre en cada request de serving (tipo, tamaño, decode) está en los archivos de <a href="#c01.archivos">c01</a>. La comparación de distribuciones en producción, con PSI y alertas, es <a href="#m12.deteccion-drift">M12</a>. El gate sobre el modelo, <a href="#m10.gate">M10</a>.</p>` },
        ],
      },

      // ======================================================== 9
      {
        id: 'autoevaluacion',
        title: 'Autoevaluación',
        titleEn: 'Self-check',
        priority: 'core',
        dims: ['tradeoffs', 'monitoreo'],
        blocks: [
          { t: 'p', html: `Responde sin mirar. Si fallas más de dos, vuelve a la sección y explica en voz alta, en inglés, de dónde salen los labels de <a href="#c01.datos">c01</a> y cómo evitas el skew.` },
          { t: 'quiz', items: [
            { q: 'Una tarea de Airflow lee 200 GB de Parquet con pandas y calcula features. ¿Qué cambiarías?', options: ['Nada: Airflow escala solo', 'Que la tarea lance un job de Spark (o un Job de Kubernetes) con la fecha como parámetro y solo espere', 'Pasar el cálculo a Kafka', 'Usar XCom para pasar el DataFrame entre tareas'], answer: 1,
              explain: 'El orquestador decide cuándo y en qué orden; el procesamiento va a un motor hecho para eso. XCom es para metadatos chicos, no para datasets.' },
            { q: 'Un job diario hace append a la tabla de features. Falla a la mitad y Airflow lo reintenta. ¿Qué pasa?', options: ['Nada, Airflow deshace la mitad', 'Filas duplicadas para ese día: "compras en 7 días" sale inflada', 'El job falla de nuevo', 'Kafka deduplica'], answer: 1,
              explain: 'Append no es idempotente. Sobrescribe la partición completa o haz upsert por key.' },
            { q: 'En el point-in-time join, ¿qué valor recibe una transacción de las 10:10 si la feature se actualizó a las 10:00 (3) y a las 10:30 (12)?', options: ['12', '3', 'El promedio', 'El valor de hoy'], answer: 1,
              explain: 'El último valor con timestamp ≤ el evento, dentro del TTL. Con el de las 10:30 le darías información del futuro.' },
            { q: '¿Cuál de estos NO es training-serving skew?', options: ['PIL en training y OpenCV en serving', 'Un timeout del lookup que manda 0 en vez del valor por defecto de training', 'Los vendedores empiezan a publicar una categoría nueva de productos', 'Otra versión de Pillow en la imagen del gateway'], answer: 2,
              explain: 'Eso es drift: cambió el mundo, no tu pipeline. Se arregla con datos nuevos; el skew, con código.' },
            { q: 'c02 parte 1 M frames al azar en 80/20. ¿Qué pasa con la métrica de test?', options: ['Es la más honesta posible', 'Sale inflada: casi cada evento tiene frames casi idénticos en train', 'Sale más baja de lo real', 'No cambia nada respecto de partir por cámara'], answer: 1,
              explain: 'Un evento de 10 s a 5 fps son 50 frames; la probabilidad de que queden todos del mismo lado es ≈ 0. Split por cámara y fecha.' },
            { q: 'Dos anotadores coinciden en el 97 % de 1,000 piezas, y cada uno marca defecto en el 2.5 %. ¿Cuánto vale kappa, aproximadamente?', options: ['0.97', '≈ 0.38', '≈ 0.95', '0'], answer: 1,
              explain: 'p<sub>e</sub> = 0.025² + 0.975² ≈ 0.951; κ = (0.97 − 0.951) / (1 − 0.951) ≈ 0.38. El acuerdo bruto lo domina la clase "buena".' },
            { q: 'Guardaste el dataset del modelo de marzo como "versión 1,234 de la tabla Delta". En septiembre no puedes leerla. ¿Por qué?', options: ['Delta no tiene time travel', 'La retención por defecto (log de 30 días, VACUUM a los 7) borró esa versión', 'Hace falta lakeFS para leer versiones', 'El formato cambió'], answer: 1,
              explain: 'Time travel no es un archivo. Lo que tiene que durar se fija: tag con retención en Iceberg, retención más larga o una copia materializada.' },
            { q: 'El active learning eligió 5,000 imágenes inciertas. ¿Para qué NO las usas?', options: ['Para entrenar', 'Para descubrir errores del modelo', 'Para estimar la accuracy que ve el usuario', 'Para mejorar la guía de etiquetado'], answer: 2,
              explain: 'Son más difíciles que el tráfico real a propósito. La accuracy real se estima con el golden set y la muestra aleatoria.' },
            { q: 'Una columna cambió de centímetros a milímetros. ¿Qué chequeo lo atrapa?', options: ['Schema estricto', 'Nulos', 'Rango o distribución contra el snapshot anterior', 'Unicidad'], answer: 2,
              explain: 'El tipo y el nombre no cambiaron. Solo un chequeo semántico (rango esperado, distribución) lo ve.' },
          ] },
          { t: 'checklist', id: 'antes-de-confiar-en-los-datos', items: [
            { id: 'fuentes-labels', html: 'Digo de dónde sale cada label, qué sesgo trae y con qué fuente independiente evalúo.' },
            { id: 'split', html: 'Nombro la unidad del split (tiempo, vendedor, cámara, lote) y deduplico por hash y casi duplicados antes de partir.' },
            { id: 'pit', html: 'Cada feature del training set tiene el valor que existía al momento de la decisión (join point-in-time, TTL, atraso real de materialización).' },
            { id: 'post-evento', html: 'Revisé que ninguna feature se actualice después del evento ni se calcule con <code>now()</code>.' },
            { id: 'preproceso', html: 'Training, evaluación y serving comparten el código de preprocesamiento o de features, con un test de referencia en CI.' },
            { id: 'log-servido', html: 'Logueo lo que vio el modelo en serving (con request_id y <code>model_version</code>) para detectar skew y unir labels tardíos.' },
            { id: 'snapshot', html: 'El dataset es un snapshot inmutable con id y manifest, y el modelo registrado apunta a él, al commit y al contenedor.' },
            { id: 'retencion', html: 'Sé cuánto dura cada versión (retención de time travel, lifecycle de S3) y cómo borro datos que haya que borrar.' },
            { id: 'guia-kappa', html: 'Hay guía con contraejemplos y versión; mido kappa por clase con doble anotación y gold questions.' },
            { id: 'aleatoria', html: 'Reservo una muestra aleatoria del presupuesto de etiquetado y no evalúo con lo que eligió el active learning.' },
            { id: 'validacion', html: 'Valido schema, rangos, duplicados, frescura y volumen antes de entrenar, y sé qué chequeo bloquea y cuál avisa.' },
            { id: 'jobs', html: 'Mis jobs de datos son particionados, idempotentes y backfillables, y alguien recibe la alerta cuando fallan.' },
          ] },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'm09-01', kind: 'concepto', q: 'Orquestación, procesamiento y mensajería: ¿qué hace cada uno y con qué herramientas?',
        a: 'Orquestación: cuándo y en qué orden, reintentos, historial, backfills (Airflow, Dagster, Argo). Procesamiento: transforma datos en batch (Spark, SQL/dbt) o streaming (Flink, Spark Structured Streaming). Mensajería: transporte durable y replay (Kafka, Kinesis, Pub/Sub). El orquestador no procesa; Kafka no es un archivo.' },
      { id: 'm09-02', kind: 'concepto', q: 'Las tres propiedades de un job de datos sano.',
        a: 'Particionado (por fecha, cada corrida procesa la suya), idempotente (correr dos veces = una; sobrescribir la partición o upsert, nunca append ciego) y backfillable (la fecha llega como parámetro, nunca <code>now()</code>).' },
      { id: 'm09-03', kind: 'trampa', q: '"Reprocesamos el último año leyendo desde Kafka."',
        a: 'Kafka retiene 7 días por defecto (configurable). La fuente de verdad histórica es el data lake, donde un sink archiva los eventos.' },
      { id: 'm09-04', kind: 'tradeoff', q: 'Batch vs streaming para features.',
        a: 'Batch: horas de frescura, fácil de reprocesar, cómputo solo mientras corre. Streaming: segundos, servicio 24/7 con estado, replay limitado, eventos tardíos. Default batch; streaming solo donde la frescura cambia la decisión (fraude, sesión).' },
      { id: 'm09-05', kind: 'concepto', q: '¿Qué resuelve un feature store?',
        a: 'Una sola definición para training y serving, offline store con historial y joins point-in-time, online store con el último valor en ms, y registry para reutilizar features entre modelos y equipos.' },
      { id: 'm09-06', kind: 'concepto', q: 'Offline store vs online store.',
        a: 'Offline: todas las versiones con timestamps en lake/warehouse; joins as-of de millones de filas; lo lee el training. Online: último valor por entidad en un KV store (Redis, DynamoDB, Bigtable); lookups de ms; lo lee el servicio. Falla típica: leakage offline, valores viejos online.' },
      { id: 'm09-07', kind: 'numero', q: 'Feature actualizada a las 10:00 (3), 10:30 (12) y 11:00 (14). Eventos a las 10:10 y 10:35: ¿qué valores reciben con join ingenuo y con PIT?',
        a: 'Ingenuo (valor de hoy): 14 y 14. Point-in-time: 3 y 12. El ingenuo le da a la compra legítima de las 10:10 información de un ataque que empezó después.' },
      { id: 'm09-08', kind: 'tradeoff', q: '¿Cuándo NO propones un feature store?',
        a: 'Cuando no hay features de entidades: c01 y c03 clasifican imágenes; la consistencia la da un paquete de preprocesamiento compartido. También con un solo modelo y pocas features, donde una librería compartida y una tabla en Redis alcanzan.' },
      { id: 'm09-09', kind: 'concepto', q: 'Regla 29 de Zinkevich y su costo.',
        a: 'Loguear las features usadas en serving y entrenar con ese log: parity por construcción. Costo: una feature nueva no tiene historia (log-and-wait) y no se puede hacer backfill de lo que nunca se logueó.' },
      { id: 'm09-10', kind: 'tradeoff', q: 'Training-serving skew vs drift.',
        a: 'Skew: tu pipeline calcula distinto; aparece desde el despliegue o tras un cambio de código; se arregla en el código. Drift: el mundo cambió; gradual o por un evento; se arregla con datos y reentrenamiento. Para separarlos, pasa los mismos ejemplos por los dos caminos.' },
      { id: 'm09-11', kind: 'trampa', q: 'Cinco causas de skew en un clasificador de imágenes.',
        a: 'PIL RGB vs OpenCV BGR; interpolación distinta (bilinear vs bicubic); orden resize/crop; JPEG draft mode en un solo lado; orientación EXIF ignorada. Más: otra versión de Pillow/OpenCV, labels.json desordenado, FP16 vs FP32.' },
      { id: 'm09-12', kind: 'trampa', q: '"El skew se arregla reentrenando con los logs de producción."',
        a: 'Reentrenar sobre inputs de un serving con bug convierte el bug en dependencia: cuando alguien arregle el gateway, el modelo empeora. El skew se corrige en el código, con un test que impida que vuelva.' },
      { id: 'm09-13', kind: 'concepto', q: 'Data leakage: definición y síntoma.',
        a: 'Información en training o evaluación que no existirá al predecir, o test demasiado parecido al train. Síntoma: métrica offline sospechosamente buena que se derrumba online. Distinto del skew: aquí hay información que no debería estar.' },
      { id: 'm09-14', kind: 'trampa', q: 'Feature "contracargos en 90 días" calculada hoy para todo el historial.',
        a: 'Cada transacción fraudulenta cuenta su propio contracargo, que llegó semanas después: el label se cuela en la feature. Se calcula con el valor vigente a la hora de la decisión.' },
      { id: 'm09-15', kind: 'numero', q: 'c02: un evento de 10 s a 5 fps en un split aleatorio 80/20. ¿Probabilidad de que sus frames queden todos del mismo lado?',
        a: '0.8<sup>50</sup> + 0.2<sup>50</sup> ≈ 0.0014 %. Casi todo evento del test tiene gemelos en train: se mide memoria. Split por cámara y fecha.' },
      { id: 'm09-16', kind: 'concepto', q: 'Unidades de split de c01, c02 y c03.',
        a: 'c01: por vendedor, tras deduplicar por sha256 y hash perceptual. c02: por cámara y fecha (más sitios enteros aparte para estimar un sitio nuevo). c03: por tiempo o por lote.' },
      { id: 'm09-17', kind: 'concepto', q: '¿Por qué deduplicas antes de partir un dataset de imágenes?',
        a: 'Hasta CIFAR tiene casi duplicados de train en test (Barz y Denzler, 2020): la métrica mide memoria. Dedupe por sha256 y pHash, luego split por entidad o tiempo.' },
      { id: 'm09-18', kind: 'trampa', q: '"El modelo de marzo usa la versión 1,234 de la tabla: time travel lo hace reproducible."',
        a: 'Delta: log de 30 días y VACUUM borra archivos pasados 7 por defecto; Iceberg: expire_snapshots borra los de más de 5 días por defecto. Fija lo que debe durar: tag con RETAIN en Iceberg, retención más larga o un snapshot materializado.' },
      { id: 'm09-19', kind: 'tradeoff', q: 'Prefijos S3 + manifest vs DVC vs lakeFS vs Delta/Iceberg.',
        a: 'Prefijos + manifest: lo más simple para imágenes (c01). DVC: punteros en git, equipos chicos; lento con millones de archivos. lakeFS: branches sin copiar sobre el lake, write-audit-publish. Delta/Iceberg: tablas con versiones, ojo con la retención.' },
      { id: 'm09-20', kind: 'concepto', q: '¿Qué tres punteros guarda cada modelo registrado?',
        a: 'Id del snapshot de datos (con su manifest), commit del código y digest del contenedor de entrenamiento. Con eso respondes con qué se entrenó, si puedes reproducirlo y qué modelos tocó un dato borrado.' },
      { id: 'm09-21', kind: 'numero', q: '1,000 piezas: 960 ambos buena, 10 ambos defecto, 15 + 15 desacuerdos. ¿Acuerdo y kappa?',
        a: 'Acuerdo 97 %; p<sub>e</sub> ≈ 0.951; κ ≈ 0.38. Acuerdo en defectos: 0.40. Tras aclarar la guía (970/20/5/5): 99 % y κ ≈ 0.79.' },
      { id: 'm09-22', kind: 'numero', q: 'Costo de etiquetado de c01: cola mensual y golden set.',
        a: '≈ 5k imágenes/mes a US$0.05–0.10 por imagen: ≈ US$250–500/mes, más ≈ US$25–50 del 10 % con doble anotación; ≈ 31–46 h. Golden set de 50k × 2 anotaciones: ≈ 560–830 h y ≈ US$5–10k una vez (estimaciones: mídelo con un piloto).' },
      { id: 'm09-23', kind: 'concepto', q: 'Cinco estrategias para elegir qué etiquetar.',
        a: 'Incertidumbre (confianza, margen, entropía), diversidad (clusters, core-set), desacuerdo (modelo vs humano o vs otro modelo), cerca del umbral (casi-rechazos de c03) y aleatoria (20–30 %: la única que estima el error real).' },
      { id: 'm09-24', kind: 'trampa', q: '¿Por qué no evalúas con las imágenes que eligió el active learning?',
        a: 'Son más difíciles que el tráfico real a propósito (o sesgadas a los errores que ya mostraba el sistema). Entrenas con ellas; evalúas con el golden set y la muestra aleatoria.' },
      { id: 'm09-25', kind: 'concepto', q: 'Qué validas en un snapshot antes de entrenar, y qué bloquea.',
        a: 'Schema, rangos, nulos, unicidad, distribución, frescura, volumen e integridad referencial. Bloquea: schema roto, labels fuera de rango, duplicados entre splits, volumen muy fuera, datos viejos. Avisa: cambios de distribución plausibles. Un chequeo nuevo empieza como aviso.' },
      { id: 'm09-26', kind: 'frase', q: '¿Cómo explicas en inglés tu split y tu dedupe en c01?',
        a: '"I split by seller and by time, after deduplicating by hash, because the same photo and the same background show up across listings."' },
      { id: 'm09-27', kind: 'frase', q: '¿Cómo defiendes en inglés no usar feature store en un clasificador de imágenes?',
        a: '"I\'d only add a feature store if we have entity features shared across models; for an image classifier, a shared preprocessing package and a parity test do the job."' },
      { id: 'm09-28', kind: 'frase', q: '¿Cómo describes en inglés la validación antes de entrenar?',
        a: '"Every snapshot is validated before training: schema, ranges, duplicates, freshness and volume against the previous one. If a blocking check fails, we don\'t train and the champion keeps serving."' },
    ],

    // ---------------------------------------------------------- glosario
    // Ya definidos en módulos o casos anteriores (no se repiten): training-serving skew,
    // feature store, point-in-time correctness, active learning, human-in-the-loop,
    // labeling, backfill, golden set, hard negative, selection bias, feedback loop,
    // prediction logging, delayed labels, data lake, event time, watermark, idempotent,
    // partition, data drift, slice.
    glossary: [
      { en: 'data leakage', es: 'fuga de datos', def: 'Información en el entrenamiento o la evaluación que no existirá al momento de predecir (features post-evento, estadísticas calculadas con el test), o un test demasiado parecido al train. Infla la métrica offline.', say: 'A 0.99 AUC is usually a sign of data leakage, not of a great model.' },
      { en: 'temporal split', es: 'split temporal', def: 'Partir train y test por fecha: se entrena con datos hasta un corte y se evalúa con los posteriores, como pasará en producción.', say: 'We use a temporal split, so the model is always tested on data from after its training cutoff.' },
      { en: 'group split', es: 'split por entidad', def: 'Partir de modo que todos los ejemplos de una entidad (vendedor, cámara, lote, paciente) queden del mismo lado, para no premiar que el modelo memorice la entidad.', say: 'It\'s a group split by camera, so no camera appears in both train and test.' },
      { en: 'near-duplicate', es: 'casi duplicado', def: 'Dos imágenes que no son idénticas byte a byte pero sí en contenido (recortes, recompresiones, frames consecutivos). Se detectan con hashes perceptuales o similitud de embeddings.', say: 'We drop near-duplicates with a perceptual hash before splitting.' },
      { en: 'shortcut learning', es: 'aprendizaje por atajos', def: 'El modelo aprende una pista espuria correlacionada con el label (la luz de la mesa de inspección, la cámara de origen) en vez de la tarea. Si test y train comparten el atajo, la métrica no lo muestra.', say: 'If a metadata-only model predicts the label, we have a shortcut the real model will find too.' },
      { en: 'offline store', es: 'almacén offline de features', def: 'Parte del feature store con el historial completo de cada feature y sus timestamps, en el lake o el warehouse. Sirve para armar datasets con joins point-in-time.', say: 'Training sets come from the offline store with a point-in-time join.' },
      { en: 'online store', es: 'almacén online de features', def: 'Parte del feature store con el último valor de cada feature por entidad, en un KV store de baja latencia, para el serving.', say: 'The service reads the card\'s features from the online store in a couple of milliseconds.' },
      { en: 'point-in-time join', es: 'join a un instante (as-of)', def: 'Unir a cada evento el último valor de cada feature con timestamp ≤ el del evento (y dentro de su TTL). Es como se logra point-in-time correctness.', say: 'A point-in-time join makes sure each example only sees what we knew at decision time.' },
      { en: 'feature materialization', es: 'materialización de features', def: 'Cargar en el online store los valores más recientes calculados por el pipeline de features. Su atraso define cuán frescas llegan las features al serving.', say: 'Materialization runs every hour, so batch features can be up to an hour stale online.' },
      { en: 'feature freshness', es: 'frescura de una feature', def: 'Tiempo desde que se calculó el valor que está usando el serving. Es una métrica de salud del online store y parte de la definición de la feature.', say: 'We alert when feature freshness goes over two hours.' },
      { en: 'log-and-wait', es: 'loguear y esperar', def: 'Agregar una feature nueva al log de serving y esperar a acumular historia antes de entrenar con ella, porque no hay forma de calcularla para el pasado.', say: 'That feature only exists at serving time, so it\'s log-and-wait for a few weeks.' },
      { en: 'workflow orchestrator', es: 'orquestador de workflows', def: 'Sistema que ejecuta DAGs de tareas: decide cuándo corre cada paso, maneja dependencias, reintentos, historial y backfills (Airflow, Dagster, Argo Workflows). No procesa los datos él mismo.', say: 'The orchestrator only triggers the Spark job; it never touches the data.' },
      { en: 'Apache Airflow', es: 'Airflow', def: 'Orquestador open source de workflows definidos en Python (DAGs). Airflow 3 agregó versionado de DAGs y backfills gestionados por el scheduler, y renombró los datasets (desde 2.4) como assets.', say: 'Airflow runs the daily DAG once the partition lands and retries each task on its own.' },
      { en: 'Apache Spark', es: 'Spark', def: 'Motor de procesamiento distribuido para batch (y streaming en micro-batch con Structured Streaming), con APIs en SQL, Python y Scala.', say: 'The daily features are a Spark job that overwrites its own date partition.' },
      { en: 'Apache Kafka', es: 'Kafka', def: 'Log distribuido y durable de eventos, particionado por key, que desacopla productores y consumidores y permite releer desde un offset dentro de su retención.', say: 'Kafka keeps a week of events; the data lake is the long-term source of truth.' },
      { en: 'Apache Flink', es: 'Flink', def: 'Motor de stream processing con estado por clave, ventanas por event time y checkpoints; procesa cada evento al llegar.', say: 'Flink keeps the per-card counters and upserts them into the online store every few seconds.' },
      { en: 'change data capture (CDC)', es: 'captura de cambios', def: 'Leer cada insert, update y delete de una base operacional (desde su log de transacciones) y publicarlo como eventos, por ejemplo con Debezium hacia Kafka.', say: 'We use change data capture instead of nightly dumps, so the lake has every update.' },
      { en: 'data contract', es: 'contrato de datos', def: 'Acuerdo explícito, idealmente ejecutable, entre el productor y los consumidores de un dato: schema, semántica (unidades, zona horaria, nulos), frescura y cómo se anuncian los cambios.', say: 'The upstream team runs our data contract in their CI, so breaking changes fail in their pull request.' },
      { en: 'data validation', es: 'validación de datos', def: 'Chequeos automáticos de schema, rangos, nulos, unicidad, distribución, frescura y volumen en la ingesta, antes de entrenar y en serving; algunos bloquean y otros avisan.', say: 'Data validation blocks the training run if the snapshot is half its usual size.' },
      { en: 'Great Expectations', es: 'Great Expectations', def: 'Librería open source (GX Core 1.x) de validación de datos con expectations declarativas, checkpoints y reportes legibles (Data Docs) sobre pandas, Spark o SQL.', say: 'We keep the expectations for each source in Great Expectations and publish the reports.' },
      { en: 'Pandera', es: 'Pandera', def: 'Librería de Python para declarar schemas y chequeos de DataFrames (pandas, Polars, PySpark) y validarlos en el pipeline o en tests.', say: 'The snapshot is validated with a Pandera schema before the training job starts.' },
      { en: 'dataset snapshot', es: 'snapshot de dataset', def: 'Versión inmutable de un dataset con id, manifest y regla de construcción. Se escribe una vez; un cambio es un snapshot nuevo. Cada modelo apunta al suyo.', say: 'The model card points to dataset snapshot ds-2026-09-01, so we can always rebuild it.' },
      { en: 'manifest', es: 'manifiesto', def: 'Tabla que lista cada ejemplo de un snapshot: hash, ruta, label, fuente del label, fecha y split. Si las imágenes se referencian por key y hash en vez de copiarse, el snapshot es solo su manifest.', say: 'A new snapshot is just a new manifest; the images themselves are never copied.' },
      { en: 'content-addressed storage', es: 'almacenamiento por contenido', def: 'Guardar cada archivo con su hash como nombre: el mismo contenido nunca se duplica y cualquier referencia es verificable.', say: 'Images live in content-addressed storage, so deduplication is free.' },
      { en: 'time travel', es: 'viaje en el tiempo (tablas)', def: 'Leer una versión anterior de una tabla Delta Lake o Iceberg (<code>VERSION AS OF</code>, <code>TIMESTAMP AS OF</code>). Limitado por la retención: el mantenimiento borra versiones viejas.', say: 'Time travel is great for debugging, but vacuum removes old versions, so it isn\'t an archive.' },
      { en: 'open table format', es: 'formato de tabla abierto', def: 'Capa de metadatos sobre archivos Parquet (Delta Lake, Apache Iceberg, Apache Hudi) que da transacciones, evolución de schema y versiones de una tabla en el object storage.', say: 'The feature tables are Iceberg, so every write is a snapshot we can tag.' },
      { en: 'DVC', es: 'DVC (Data Version Control)', def: 'Herramienta open source que versiona datos junto al código: git guarda punteros con hashes y los datos viven en un remote.', say: 'For a small team, DVC keeps the dataset version next to the code that used it.' },
      { en: 'write-audit-publish (WAP)', es: 'escribir, auditar, publicar', def: 'Patrón para datos: el job escribe en un lugar aislado (branch de lakeFS, branch o snapshot de Iceberg), la validación lo audita y solo si pasa se publica a la tabla que leen los consumidores.', say: 'New partitions follow write-audit-publish, so consumers never read data that failed validation.' },
      { en: 'lakeFS', es: 'lakeFS', def: 'Capa de control de versiones tipo git (branches, commits, merges) sobre el object storage, con API compatible con S3 y branches sin copia de datos.', say: 'We write the new data to a lakeFS branch, validate it, and merge only if it passes.' },
      { en: 'labeling guidelines', es: 'guía de etiquetado', def: 'Documento versionado con la definición operativa de cada clase, ejemplos, contraejemplos y los casos límite ya decididos.', say: 'Every disagreement we resolve goes back into the labeling guidelines.' },
      { en: 'gold question', es: 'pregunta de control', def: 'Ejemplo con respuesta conocida mezclado en la cola de etiquetado, sin que el anotador lo sepa, para medir su exactitud.', say: 'About five percent of each batch are gold questions, so we track accuracy per annotator.' },
      { en: 'inter-annotator agreement', es: 'acuerdo entre anotadores', def: 'Cuánto coinciden anotadores distintos sobre los mismos ejemplos. Se reporta corregido por azar (kappa) y por clase.', say: 'Inter-annotator agreement on cracks is our ceiling: the model can\'t be more consistent than the inspectors.' },
      { en: "Cohen's kappa", es: 'kappa de Cohen', def: 'Acuerdo entre dos anotadores corregido por el acuerdo esperado al azar: κ = (p<sub>o</sub> − p<sub>e</sub>) / (1 − p<sub>e</sub>). Con una clase dominante, un 97 % de acuerdo puede ser κ ≈ 0.4.', say: 'Raw agreement is ninety-seven percent, but Cohen\'s kappa is only 0.38, because almost every part is good.' },
      { en: 'label noise', es: 'ruido en los labels', def: 'Labels incorrectos en el dataset. Pone un techo a la accuracy medible y mueve las comparaciones entre modelos; los sospechosos se mandan a revisión humana.', say: 'We send high-confidence disagreements to review, because some of them are label noise.' },
      { en: 'uncertainty sampling', es: 'muestreo por incertidumbre', def: 'Estrategia de active learning que elige para etiquetar los ejemplos donde el modelo tiene menos confianza, menor margen o mayor entropía.', say: 'Uncertainty sampling fills most of the queue, but we keep a random slice for evaluation.' },
      { en: 'weak label', es: 'label débil', def: 'Label abundante y barato pero ruidoso o sesgado, obtenido de una señal indirecta (la categoría que eligió el vendedor, un click, un veredicto de evento).', say: 'The seller\'s final category is a weak label: it\'s biased toward whatever we suggested.' },
      { en: 'data flywheel', es: 'volante de datos', def: 'Ciclo en el que el sistema en producción genera los datos que mejoran al siguiente modelo: servir y loguear, elegir qué etiquetar, etiquetar, versionar, validar, reentrenar.', say: 'The design is really a data flywheel: every month of traffic makes the next model better.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
