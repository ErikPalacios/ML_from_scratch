/* =============================================================================
   Ronda de Diseño ML — js/content/m13-nube.js
   Módulo 13: nube. Qué se pregunta (servicio + porqué + orden de costo), tabla de
   equivalencias AWS / Google Cloud / Azure (fuente de la hoja ref-herramientas),
   plataformas gestionadas de ML, managed vs self-hosted con números de c01 y c05,
   instancias GPU y precio por GPU-hora, spot, costos ocultos (egress, NAT, cruce de
   AZ, LCUs del ALB, logs, requests de S3, GPUs ociosas), compromisos (RIs, Savings
   Plans, CUDs) y cuotas / regiones.
   Contrato: docs/SPEC.md §5. Ejemplos: c01 (EKS, 2 × g4dn.xlarge, ALB ≈ US$500),
   c04 (g6.2xlarge con KEDA y scale to zero), c05 (Textract, Step Functions), c06.
   Precios: la fuente de verdad del curso es ref-numeros.js (costos y gpus); aquí se
   repiten igual. Verificado (oct. 2026) contra documentación oficial: EC2 (aviso de
   spot de 2 min; cuotas por vCPU "Running On-Demand G and VT instances" L-DB2E81BA y
   "P" L-417A185B; Capacity Reservations; Capacity Blocks for ML: hasta 8 semanas
   antes, pago por adelantado, sin Savings Plans), Compute Engine (Spot VMs: hasta
   91 %, apagado de hasta 30 s; CUDs por recurso hasta 55 % / 70 %, GPUs con reserva
   adjunta; flex CUDs con GPU solo G2 y G4; tabla de GPUs por zona), Azure (Spot con
   aviso mínimo de 30 s por Scheduled Events, best effort; Azure ML sin cargo adicional sobre el cómputo;
   Azure Cache for Redis en retiro → Azure Managed Redis), SageMaker AI (renombre del
   3-dic-2024; InvokeEndpoint: cuerpo ≤ 6,291,456 B y 60 s; medidor publicado de "data
   processed" de SageMaker Hosting US$0.016/GB de entrada y de salida; ml.g4dn.xlarge
   US$0.736, ml.g5.xlarge US$1.408, ml.c5.xlarge US$0.204 en la lista de precios de
   hosting; scale to zero con inference components desde nov-2024; SageMaker Savings
   Plans hasta 64 %), ECR (las capas de la imagen bajan de S3: hace falta el gateway
   endpoint de S3 además de ecr.api y ecr.dkr),
   Google Cloud Next '26 (Vertex AI pasa a Gemini Enterprise Agent Platform, abril de
   2026), App Runner (cerrado a clientes nuevos desde el 30-abr-2026 → ECS Express
   Mode), Cloud Run functions (ago-2024), Container Registry (apagado en 2025), VPC /
   PrivateLink / NAT, CloudWatch Logs, EKS (soporte extendido US$0.60/h), Textract,
   MSK (replicación entre brokers sin cargo). Precios de GCP y
   Azure, descuentos observados de spot y de reservas: agregadores públicos
   (instances.vantage.sh, doit.com, gcloud-compute.com) en oct. 2026 → marcados como
   estimación. Cada cálculo se recalculó con Python (scratchpad, calcs.py); el script
   de la sección "compromisos" corrió tal cual.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // Marca de estimación (SPEC §5.3): subrayado punteado + "est."
  const E = (s) => '<span class="est">' + s + '</span>';

  // ------------------------------------------------------------ diagrama
  // Dónde se va el dinero en la red de c01. Cuatro carriles: internet, AZ a, AZ b y
  // servicios regionales. Columnas x = 4, 30, 58 y 84. El ALB baja a la AZ b por
  // x = 27 (entre la columna vacía y los gateways); el cruce de AZ sube por y = 27.75,
  // en el hueco entre filas. NAT y endpoint de S3 en la columna derecha, con el
  // registry público arriba y S3 abajo, para que ninguna arista cruce un nodo. El
  // endpoint de S3 va en su propio carril ("toda la VPC"): no es zonal. Punteado =
  // camino caro que se evita (cruce de AZ, pull por el NAT).
  const RED = {
    width: 108, height: 54,
    lanes: [
      { id: 'inet', label: 'Internet', x: 0, y: 0, w: 108, h: 12, kind: 'online' },
      { id: 'aza', label: 'VPC · AZ a', x: 0, y: 13.5, w: 108, h: 12.5, kind: 'neutral' },
      { id: 'azb', label: 'VPC · AZ b', x: 0, y: 27.5, w: 80, h: 12.5, kind: 'neutral' },
      { id: 'vpc', label: 'Toda la VPC', x: 81.5, y: 27.5, w: 26.5, h: 12.5, kind: 'neutral' },
      { id: 'reg', label: 'Servicios regionales', x: 0, y: 41.5, w: 108, h: 12.5, kind: 'offline' },
    ],
    nodes: [
      { id: 'client', label: 'Apps y callers', sub: 'foto ≈ 200 KB', x: 4, y: 3.5, w: 18, h: 7, kind: 'client',
        note: 'Suben la foto en el body. Subir datos a AWS no se cobra; la respuesta (≈ 1 KB de JSON) sí sale por internet a ≈ US$0.09/GB, pero 304 M respuestas al mes son ≈ 0.3 TB: ≈ US$27 (≈ US$18 descontando los 100 GB/mes gratis). En c01 el egress no importa; en un sistema que devuelve imágenes o video, manda.' },
      { id: 'alb', label: 'ALB', sub: 'cobra por LCU', x: 30, y: 3.5, w: 18, h: 7, kind: 'edge',
        note: 'US$0.0225/h + US$0.008 por LCU-hora. Con la foto en el body, la dimensión que manda es bytes procesados (1 GB/h por LCU): ≈ 61 TB al mes son ≈ 83 LCUs en promedio, ≈ US$500/mes. Es ≈ 30 % de la infra de c01 y nadie lo ve venir.' },
      { id: 'hub', label: 'Registry público', sub: 'Docker Hub · HF Hub', x: 84, y: 3.5, w: 20, h: 7, kind: 'external',
        note: 'Imágenes base y pesos descargados de internet. Desde una subred privada, cada GB pasa por el NAT gateway y paga US$0.045. Además, Docker Hub limita los pulls anónimos: espeja las imágenes en ECR (<a href="#m05.registries">M5</a>).' },
      { id: 'gwa', label: 'Gateway AZ a', sub: 'c6i · FastAPI', x: 30, y: 17, w: 18, h: 7, kind: 'service',
        note: 'Valida, decodifica y arma el tensor. Habla con el Triton de su misma zona: ese tráfico es gratis. El costo del tier es predecible: 2 × c6i.xlarge ≈ US$248/mes.' },
      { id: 'tra', label: 'Triton AZ a', sub: 'g4dn.xlarge · T4', x: 58, y: 17, w: 18, h: 7, kind: 'gpu',
        note: 'US$0.526/h ≈ US$384/mes, ocupado al ≈ 5 % de su máximo medido en promedio. Al arrancar baja la imagen de Triton (≈ 9 GB) y el engine: si lo hace por el NAT, paga por GB cada arranque.' },
      { id: 'nat', label: 'NAT gateway', sub: 'US$0.045 por GB', x: 84, y: 17, w: 20, h: 7, kind: 'edge',
        note: 'US$0.045/h + US$0.045 por GB procesado, en cualquier dirección. Lo que conviene que pase por aquí: parches y llamadas a terceros. Lo que no: S3 (gateway endpoint, sin cargo por GB) ni ECR, que usa los interface endpoints <code>ecr.api</code> y <code>ecr.dkr</code> (≈ US$0.01/h por zona cada uno; mueven poco: manifiestos y llamadas a la API) más el gateway endpoint de S3, porque las capas de la imagen se descargan de S3. Aquí se dibuja uno; en el diseño real hay un NAT por zona, porque si hay uno solo para dos zonas, el tráfico de la AZ b además cruza de AZ.' },
      { id: 'gwb', label: 'Gateway AZ b', sub: 'c6i · FastAPI', x: 30, y: 31, w: 18, h: 7, kind: 'service',
        note: 'Igual que el de la AZ a. Si su Service de Kubernetes reparte al azar, ≈ la mitad de sus tensores de 602 KB van al Triton de la otra zona: ese es el cruce de AZ de la flecha punteada.' },
      { id: 'trb', label: 'Triton AZ b', sub: 'g4dn.xlarge · T4', x: 58, y: 31, w: 18, h: 7, kind: 'gpu',
        note: 'La réplica N+1. Lee el engine desde S3 a través del gateway endpoint: ese camino no cobra por GB.' },
      { id: 'vpce', label: 'Endpoint de S3', sub: 'gateway · sin cargo/GB', x: 84, y: 31, w: 20, h: 7, kind: 'edge',
        note: 'Un VPC endpoint de tipo gateway para S3 (y DynamoDB) no cobra ni por hora ni por GB: es una entrada en las tablas de rutas, así que no vive en una zona y lo usan los nodos de las dos (aquí se dibuja junto al Triton de la AZ b por espacio). También es por donde bajan las capas de las imágenes de ECR. Es la línea más barata de toda la factura y la que más se olvida.' },
      { id: 'cw', label: 'CloudWatch Logs', sub: 'US$0.50 por GB ingerido', x: 30, y: 45, w: 18, h: 7, kind: 'monitor',
        note: 'Cobra al ingerir (US$0.50/GB en la clase estándar) y al guardar (US$0.03/GB-mes). Los logs de predicción de c01 van a S3 por Fluent Bit; a CloudWatch solo los del servicio. Un log de debug con el payload puede costar más que una GPU.' },
      { id: 'otra', label: 'Otra región', sub: 'US$0.02 por GB', x: 58, y: 45, w: 18, h: 7, kind: 'external',
        note: 'Replicar S3 o ECR a otra región (DR, multi-región) paga transferencia entre regiones: ≈ US$0.02/GB desde us-east-1 a casi todas (US$0.01 a us-east-2). c01 no lo necesita con 99.9 %; <a href="#m15.multi-region-dr">M15</a> discute cuándo sí.' },
      { id: 's3', label: 'S3', sub: 'pesos · logs · datos', x: 84, y: 45, w: 20, h: 7, kind: 'store',
        note: 'US$0.023/GB-mes y, además, por request: US$0.005 por 1,000 PUT y US$0.0004 por 1,000 GET. Con objetos grandes, el costo son los GB; con millones de objetos chicos, los requests.' },
    ],
    edges: [
      { from: 'client', to: 'alb', kind: 'online', label: 'fotos' },
      { from: 'alb', to: 'gwa', kind: 'online', fromSide: 'b', toSide: 't' },
      { from: 'alb', to: 'gwb', kind: 'online', fromSide: 'b', toSide: 'l', via: [[39, 12.75], [27, 12.75], [27, 34.5]] },
      { from: 'gwa', to: 'tra', kind: 'online', label: 'tensor' },
      { from: 'gwb', to: 'trb', kind: 'online', label: 'tensor' },
      { from: 'gwb', to: 'tra', kind: 'neutral', dashed: true, fromSide: 't', toSide: 'b', via: [[39, 27.75], [67, 27.75]], label: 'cruce de AZ' },
      { from: 'tra', to: 'nat', kind: 'offline', dashed: true, label: 'pull' },
      { from: 'nat', to: 'hub', kind: 'offline', dashed: true, fromSide: 't', toSide: 'b', label: 'imágenes · pesos' },
      { from: 'trb', to: 'vpce', kind: 'offline', label: 'engine' },
      { from: 'vpce', to: 's3', kind: 'offline', fromSide: 'b', toSide: 't' },
      { from: 'gwb', to: 'cw', kind: 'monitor', fromSide: 'b', toSide: 't', label: 'logs' },
      { from: 's3', to: 'otra', kind: 'offline', fromSide: 'l', toSide: 'r', label: 'réplica' },
    ],
    flows: [
      { id: 'request', label: 'Un request: quién cobra', steps: [
        { nodes: ['client', 'alb'], edges: ['client>alb'], text: 'La foto entra por internet: subirla es gratis. El ALB cobra por la hora y por LCU; con fotos de ≈ 200 KB, la LCU que manda es la de bytes procesados: ≈ US$500/mes en c01.' },
        { nodes: ['alb', 'gwa'], edges: ['alb>gwa'], text: 'El ALB reparte entre los gateways de las dos zonas. Ese salto no tiene cargo de transferencia: el ALB ya lo cobra en sus LCUs.' },
        { nodes: ['gwa', 'tra'], edges: ['gwa>tra'], text: 'Gateway y Triton en la misma zona: gratis. El tensor FP32 de 602 KB pesa 3× el JPEG, pero no cuesta nada mientras no cruce de zona.' },
      ] },
      { id: 'cruce', label: 'Sin ruteo por zona: el cruce de AZ', steps: [
        { nodes: ['gwb', 'tra'], edges: ['gwb>tra'], text: 'Si el Service reparte al azar, ≈ la mitad de los tensores cruza a la otra zona: ≈ 90 TB/mes × US$0.02/GB (US$0.01 al salir y US$0.01 al entrar) ≈ US$1,800/mes, más que las dos GPUs.' },
        { nodes: ['gwb', 'trb'], edges: ['gwb>trb'], text: 'Con <code>trafficDistribution: PreferSameZone</code> (<a href="#m06.alta-disponibilidad">M6</a>) cada gateway prefiere el Triton de su zona y ese costo casi desaparece.' },
      ] },
      { id: 'arranque', label: 'Un nodo GPU que arranca', steps: [
        { nodes: ['tra', 'nat', 'hub'], edges: ['tra>nat', 'nat>hub'], text: 'El camino que se evita (punteado): si el nodo baja la imagen de Docker Hub o los pesos de Hugging Face, cada GB paga US$0.045 de NAT. Con un modelo de 141 GB son ≈ US$6.3 por réplica que arranca (<a href="#m05.pesos-modelo">M5</a>).' },
        { nodes: ['trb', 'vpce', 's3'], edges: ['trb>vpce', 'vpce>s3'], text: 'El mismo engine leído de S3 por el gateway endpoint: cero por GB. La regla: todo lo pesado y repetido viene de S3 o ECR por endpoints (las capas de ECR también bajan de S3), nunca por el NAT.' },
      ] },
      { id: 'logs', label: 'Logs y réplicas', steps: [
        { nodes: ['gwb', 'cw'], edges: ['gwb>cw'], text: 'Cada GB que entra a CloudWatch Logs cuesta US$0.50. Los logs del servicio, sí; el log de predicción de 10 M requests al día, a S3 en Parquet.' },
        { nodes: ['s3', 'otra'], edges: ['s3>otra'], text: 'Replicar a otra región paga ≈ US$0.02/GB más el almacenamiento duplicado. Se decide por un requisito de disponibilidad o de recuperación, no "por si acaso".' },
      ] },
    ],
  };

  // ------------------------------------------------------------ código
  // Corrió con Python 3.14 (sin dependencias). Imprime exactamente lo de los comentarios.
  const COSTOS_PY = `def spot_efectivo(horas_trabajo, usd_h_spot, interrupciones, min_perdidos):
    """Costo de un job en spot: el trabajo + lo que se repite tras cada interrupción.
    min_perdidos ≈ mitad del intervalo de checkpoint + el reinicio."""
    horas = horas_trabajo + interrupciones * min_perdidos / 60
    return horas * usd_h_spot

def compromiso_conviene(descuento, uso_esperado):
    """Un compromiso se paga se use o no: conviene si usas más de (1 - descuento)."""
    return uso_esperado > 1 - descuento

# 1) Facturado vs ocupado: c04 factura ≈ 15 nodo-h/día, trabaja ≈ 8.3
fact, ocup = 15 * 30 * 0.98, 8.3 * 30 * 0.98
print(f"c04: facturado US\${fact:.0f}, ocupado US\${ocup:.0f}, ocioso {1 - ocup / fact:.0%}")
# c04: facturado US$441, ocupado US$244, ocioso 45%

# 2) Fine-tune de 40 h en g5.xlarge: on-demand vs spot con checkpoints cada 30 min
od = 40 * 1.006
sp = spot_efectivo(40, 0.462, interrupciones=4, min_perdidos=25)
print(f"on-demand US\${od:.2f}, spot US\${sp:.2f}, ahorro {1 - sp / od:.0%}")
# on-demand US$40.24, spot US$19.25, ahorro 52%

# 3) ¿Comprometer 4 T4 a 1 año (≈ 37 % menos) si en promedio usas 2.33?
#    (base de 2 + 2 réplicas de ráfaga ≈ 4 h al día: 2 + 2 × 4 / 24)
print(compromiso_conviene(0.37, uso_esperado=2.33 / 4))  # False: pagas aire
print(compromiso_conviene(0.37, uso_esperado=2.0 / 2))   # True: la base N+1 siempre está`;

  // Sintaxis verificada contra la referencia de AWS CLI v2 y gcloud (ayuda local).
  const CUOTAS_SH = `# ¿Cuántos vCPUs de instancias G (g4dn, g5, g6, g6e…) on-demand puedo tener en esta región?
aws service-quotas get-service-quota --service-code ec2 \\
  --quota-code L-DB2E81BA --region us-east-1 \\
  --query 'Quota.[QuotaName,Value]'

# Pedir más ANTES de necesitarlo (para c01: 28 vCPUs, ver el cálculo de la sección)
aws service-quotas request-service-quota-increase --service-code ec2 \\
  --quota-code L-DB2E81BA --desired-value 32 --region us-east-1

# ¿En qué zonas de esta región existe el tipo de instancia? (p. ej. México Central)
aws ec2 describe-instance-type-offerings --location-type availability-zone \\
  --filters Name=instance-type,Values=g6.xlarge --region mx-central-1 \\
  --query 'InstanceTypeOfferings[].Location'

# Historial de precio spot (hasta 90 días): el descuento real, no el de la publicidad
aws ec2 describe-spot-price-history --instance-types g6.2xlarge \\
  --product-descriptions "Linux/UNIX" --start-time 2026-09-01T00:00:00 \\
  --region us-east-1 \\
  --query 'SpotPriceHistory[].[AvailabilityZone,SpotPrice,Timestamp]' --output table

# Google Cloud: qué aceleradores hay en las zonas de una región
gcloud compute accelerator-types list \\
  --filter="zone:( us-central1-a us-central1-b us-central1-c )"`;

  // ------------------------------------------------------------ registro
  MSD.register({
    id: 'm13',
    kind: 'module',
    sections: [
      // ======================================================== 1
      {
        id: 'por-que',
        title: 'Qué se pregunta de nube (y qué no)',
        titleEn: 'What interviewers actually ask about cloud',
        priority: 'core',
        dims: ['estimaciones', 'tradeoffs', 'comunicacion'],
        blocks: [
          { t: 'p', html: `Nadie en una ronda de ML System Design te va a preguntar en qué menú de la consola está el botón de crear un endpoint. Lo que sí escuchas, casi siempre como follow-up: "¿y eso dónde corre?", "¿por qué no SageMaker?", "¿cuánto cuesta al mes?", "¿y si no hay GPUs en la región?". Es un módulo de frecuencia <b>baja</b>: no es el centro de la entrevista, pero una respuesta floja aquí hace que el entrevistador dude de los números que diste antes.` },
          { t: 'p', html: `La buena noticia: casi todo se resuelve con un patrón de tres partes. <b>Servicio + porqué + orden de magnitud del costo.</b> Ejemplo con <a href="#c01">c01</a>: "Triton on EKS with two g4dn.xlarge, one per zone, because the company already runs EKS: about US$770 a month in GPUs. A managed endpoint costs about 40 % more per instance, plus a per-GB fee that hurts with images." Una frase, tres datos, y el entrevistador ya sabe que entiendes el trade-off.` },
          { t: 'table', caption: 'Las preguntas de nube que sí aparecen', head: ['Pregunta', 'Qué evalúa de verdad', 'Dónde está en este módulo'], rows: [
            ['"¿En qué servicio lo corres?"', 'Que elijas por quién opera, volumen y payload, no por moda', '<a href="#m13.managed-vs-self">Managed vs self-hosted</a>'],
            ['"Estamos en GCP / Azure, ¿cambia algo?"', 'Que tu diseño no dependa de un nombre de producto', '<a href="#m13.equivalencias">Equivalencias</a>'],
            ['"¿Qué GPU y cuánto cuesta?"', 'Orden de magnitud por hora y por mes; la instancia más chica que cumple', '<a href="#m13.gpus-precios">GPUs y precios</a>'],
            ['"¿Cómo lo abaratas?"', 'Spot donde se puede, compromisos sobre la base, y encontrar el costo que no es GPU', '<a href="#m13.spot">Spot</a>, <a href="#m13.costos-ocultos">costos ocultos</a>, <a href="#m13.compromisos">compromisos</a>'],
            ['"¿Y si no hay capacidad?"', 'Que sepas que las GPUs se acaban: cuotas, zonas, reservas', '<a href="#m13.cuotas-regiones">Cuotas y regiones</a>'],
          ] },
          { t: 'steps', items: [
            { title: 'Aclarar', meta: 'min 0–5', html: '<p>Una pregunta: "¿en qué nube están y hay un equipo que opere Kubernetes?". La respuesta decide la mitad de lo que viene (<a href="#m01.preguntas-aclaracion">M1</a>).</p>' },
            { title: 'Estimar', meta: 'min 10–15', html: '<p>Cuando calculas GPUs, multiplica por el precio y por 730: "two T4s, about US$770 a month". Agrega los bytes por mes si el payload es grande: de ahí sale el costo de red.</p>' },
            { title: 'Arquitectura', meta: 'min 15–25', html: '<p>Dibuja con categorías (cola, object storage, tier de GPU) y pon el nombre del servicio al lado. Si el entrevistador está en otra nube, cambias la etiqueta, no la caja.</p>' },
            { title: 'Cierre', meta: 'min 42–45', html: '<p>Una frase de costo total contra el presupuesto y dos palancas en orden de riesgo (compromiso sobre la base, spot para lo batch). Es lo que <a href="#c01.costo">c01</a> hace en su resumen.</p>' },
          ] },
          { t: 'kv', items: [
            ['1 mes', '730 h', 'Costo mensual = US$/h × 730 (<a href="#ref-numeros.tiempo-disponibilidad">hoja de números</a>)'],
            ['T4 (g4dn.xlarge)', E('≈ US$0.53/h ≈ US$384/mes'), 'La GPU de inferencia más barata de AWS para CNNs'],
            ['L4 (g6.xlarge)', E('≈ US$0.80/h ≈ US$588/mes'), 'La sucesora: más throughput, FP8, ≈ 53 % más cara por hora'],
            ['H100', E('≈ US$6.88 por GPU-hora'), 'p5: un orden de magnitud sobre la T4'],
            ['Cruce de AZ', 'US$0.01/GB en cada sentido', 'Barato por GB, caro por volumen'],
            ['NAT gateway', 'US$0.045 por GB procesado', 'El costo oculto más clásico'],
            ['Egress a internet', E('≈ US$0.09/GB'), 'Primeros 10 TB/mes; subir datos no se cobra'],
            ['CloudWatch Logs', 'US$0.50 por GB ingerido', '≈ 20× lo que cuesta guardar ese GB un mes en S3'],
          ] },
          { t: 'callout', kind: 'skip', html: `<p>Sáltate: rutas de la consola, nombres de cada tamaño de instancia, la sintaxis de las políticas de IAM, los tramos completos de precios y las noticias de lanzamientos. Si el entrevistador quiere un número exacto, la respuesta correcta es el orden de magnitud y "lo verifico en la calculadora". Memoriza la tabla de arriba, la de <a href="#ref-numeros.costos">costos de la hoja de números</a> y la lista de costos ocultos; con eso alcanza. Si tienes 15 minutos: esta sección, <a href="#m13.managed-vs-self">managed vs self-hosted</a> y <a href="#m13.costos-ocultos">costos ocultos</a>.</p>` },
          { t: 'callout', kind: 'trap', title: 'Trampa: name-dropping de servicios', html: `<p>"Lo pongo en SageMaker con Kinesis, Step Functions y Feature Store" sin decir por qué ni cuánto cuesta suena a alguien que leyó la página del producto. Cada servicio que nombras abre una pregunta ("¿por qué Kinesis y no SQS?"). Nombra pocos, y cada uno con su porqué.</p>` },
          { t: 'callout', kind: 'senior', html: `<p>Lo que anota el entrevistador: que preguntas en qué nube está la empresa antes de nombrar servicios; que tu arquitectura se describe con categorías (cola, object storage, Kubernetes gestionado) y los nombres son un detalle; que das un costo mensual con su supuesto; y que sabes que la factura de un sistema de ML rara vez es solo GPU.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"Before naming services: which cloud are you on, and is there a platform team running Kubernetes? I'll describe the design with generic building blocks (a queue, object storage, a GPU tier) and map them to your provider. For cost, I'll give monthly orders of magnitude and the assumption behind each one."</p>` },
          { t: 'callout', kind: 'connect', html: `<p>El costo por predicción y por qué la utilización manda está en <a href="#m04.costo-por-prediccion">M4</a>; Kubernetes gestionado vs endpoints gestionados vs serverless, en <a href="#m06.por-que-k8s">M6</a> y <a href="#m06.serverless">M6 · serverless</a>; los precios de referencia, en <a href="#ref-numeros.costos">la hoja de números</a>. La seguridad, la privacidad y el multi-región como confiabilidad, en <a href="#m15">M15</a>.</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'equivalencias',
        title: 'Equivalencias AWS / Google Cloud / Azure',
        titleEn: 'AWS / GCP / Azure service equivalents',
        priority: 'extra',
        dims: ['arquitectura', 'comunicacion'],
        blocks: [
          { t: 'p', html: `Los casos del curso usan AWS porque es la nube que más aparece en entrevistas. Si la empresa usa otra, el diseño no cambia: cambian los nombres. Esta tabla es la que copia la <a href="#ref-herramientas">hoja de herramientas</a>. Nombres verificados a octubre de 2026; varios cambiaron hace poco y te los pueden corregir en la entrevista (última columna y tabla de abajo).` },
          { t: 'table', caption: 'Mismo bloque, tres nombres (oct. 2026)', head: ['Categoría', 'AWS', 'Google Cloud', 'Azure', 'Nota'], rows: [
            ['Máquinas virtuales', 'Amazon EC2', 'Compute Engine', 'Azure Virtual Machines', ''],
            ['VMs con GPU', 'EC2 G (g4dn, g5, g6, g6e) y P (p4d, p5)', 'N1 + T4, G2 (L4), A2 (A100), A3 (H100), G4 (RTX PRO 6000)', 'NCasT4_v3 (T4), NC A100 v4, NCads H100 v5, ND H100 v5 (8 × H100)', 'Detalle en <a href="#m13.gpus-precios">GPUs y precios</a>'],
            ['Kubernetes gestionado', 'Amazon EKS', 'GKE', 'AKS', 'Control plane ' + E('≈ US$0.10/h') + ' por cluster; AKS tiene además un tier gratis sin SLA'],
            ['Contenedores serverless', 'AWS Fargate (con ECS o EKS; sin GPU); ECS Express Mode', 'Cloud Run (con GPU)', 'Azure Container Apps (con GPU)', 'AWS App Runner cerró a clientes nuevos el 30-abr-2026; AWS recomienda ECS Express Mode'],
            ['Funciones', 'AWS Lambda', 'Cloud Run functions', 'Azure Functions', 'Cloud Functions se renombró Cloud Run functions en agosto de 2024'],
            ['Object storage', 'Amazon S3', 'Cloud Storage', 'Azure Blob Storage', ''],
            ['Block storage (disco de la VM)', 'Amazon EBS', 'Persistent Disk · Hyperdisk', 'Azure Managed Disks', ''],
            ['Cola de mensajes', 'Amazon SQS', 'Pub/Sub (Cloud Tasks para tareas HTTP)', 'Azure Service Bus · Queue Storage', 'Queue Storage es la cola simple y barata; Service Bus, la de DLQ, sesiones y orden'],
            ['Streaming de eventos', 'Kinesis Data Streams · Amazon MSK (Kafka)', 'Pub/Sub · Managed Service for Apache Kafka', 'Azure Event Hubs (habla el protocolo de Kafka)', '<a href="#m02.streaming">M2</a>'],
            ['Orquestación de workflows', 'AWS Step Functions', 'Workflows', 'Logic Apps · Durable Functions', 'c05 usa Step Functions (<a href="#c05.arquitectura">c05</a>)'],
            ['SQL gestionado', 'Amazon RDS · Aurora', 'Cloud SQL · AlloyDB', 'Azure Database for PostgreSQL · Azure SQL Database', ''],
            ['Key-value y caché', 'DynamoDB · ElastiCache (Valkey, Redis OSS)', 'Firestore · Bigtable · Memorystore', 'Cosmos DB · Azure Managed Redis', 'Azure Cache for Redis está en retiro: Azure Managed Redis es el reemplazo'],
            ['Data warehouse', 'Amazon Redshift', 'BigQuery', 'Microsoft Fabric (Warehouse) · Azure Synapse Analytics', ''],
            ['Container registry', 'Amazon ECR', 'Artifact Registry', 'Azure Container Registry', 'Google apagó Container Registry en 2025'],
            ['Secretos y llaves', 'Secrets Manager · AWS KMS', 'Secret Manager · Cloud KMS', 'Azure Key Vault', '<a href="#m15.secretos">M15</a>'],
            ['Monitoreo y logs', 'Amazon CloudWatch · Managed Service for Prometheus', 'Cloud Monitoring · Cloud Logging · Managed Service for Prometheus', 'Azure Monitor (Log Analytics, Application Insights, Prometheus gestionado)', '<a href="#m12.prometheus-grafana">M12</a>'],
            ['Acceso privado a servicios', 'VPC endpoints (gateway e interface / PrivateLink)', 'Private Google Access · Private Service Connect', 'Private Endpoint (Private Link)', 'La salida al costo del NAT (<a href="#m13.costos-ocultos">costos ocultos</a>)'],
            ['Balanceador L7', 'Application Load Balancer (ALB)', 'Cloud Load Balancing (Application LB)', 'Application Gateway', ''],
            ['Plataforma de ML', 'Amazon SageMaker AI', 'Gemini Enterprise Agent Platform (ex Vertex AI)', 'Azure Machine Learning', 'SageMaker se renombró SageMaker AI el 3-dic-2024; Vertex AI pasó a Agent Platform en abril de 2026'],
            ['Endpoints de modelos', 'SageMaker AI: real-time, asynchronous, serverless, batch transform', 'Agent Platform: online inference endpoints, batch inference', 'Azure ML: managed online endpoints, batch endpoints', '<a href="#m13.plataformas-ml">Plataformas de ML</a>'],
          ], note: 'Los modelos fundacionales por API viven aparte: Amazon Bedrock, el Model Garden de Agent Platform y Microsoft Foundry (antes Azure AI Foundry; anunciado a fines de 2025, vigente desde enero de 2026). Eso es <a href="#m14">M14</a>.' },
          { t: 'callout', kind: 'trap', title: 'Trampa: "equivalente" no es "idéntico"', html: `<p>La tabla mapea categorías, no semántica. Tres diferencias que sí cambian un diseño: (1) <b>Pub/Sub</b> hace a la vez de cola y de stream, pero no es Kafka: no hay particiones que tú controles ni offsets que puedas rebobinar libremente (tiene seek por tiempo o snapshot). (2) <b>Cloud Run</b> recibe requests HTTP y escala por requests en vuelo, hasta cero; <b>Fargate</b> es un runtime de tareas: el autoscaling y el balanceador los configuras tú (con ECS o EKS). (3) En Azure, <b>Event Hubs</b> es para streams y <b>Service Bus</b> para mensajes de negocio con DLQ; confundirlos es como usar Kinesis de cola de trabajos.</p>` },
          { t: 'table', caption: 'Los cambios de nombre que te pueden corregir', head: ['Antes', 'Ahora', 'Desde', 'Qué cambió en la práctica'], rows: [
            ['Amazon SageMaker', 'Amazon SageMaker AI', '3-dic-2024', 'Solo el nombre: APIs, CLI y endpoints siguen diciendo <code>sagemaker</code>. "Amazon SageMaker" ahora es la plataforma unificada de datos y analítica que lo incluye'],
            ['Vertex AI', 'Gemini Enterprise Agent Platform ("Agent Platform")', 'Abril de 2026 (Cloud Next \'26)', 'Training, endpoints, pipelines, registry y feature store llevan el prefijo Agent Platform; la documentación sigue en rutas <code>vertex-ai</code>. En entrevistas todavía se dice Vertex AI y se entiende'],
            ['Azure AI Foundry', 'Microsoft Foundry', 'Anunciado a fines de 2025; vigente desde ene-2026', 'Es el lado de modelos fundacionales y agentes; Azure Machine Learning sigue siendo la plataforma de MLOps para tus propios modelos'],
            ['Cloud Functions', 'Cloud Run functions', 'Agosto de 2024', 'Las funciones corren sobre Cloud Run'],
            ['AWS App Runner', '(cerrado a clientes nuevos)', '30-abr-2026', 'Los existentes siguen; sin funciones nuevas. AWS sugiere ECS Express Mode'],
          ] },
          { t: 'callout', kind: 'skip', html: `<p>Si la empresa no usa Azure, no memorices los nombres de Azure. Aprende la columna de tu nube objetivo y la de AWS, y para las otras basta con decir la categoría: "the managed Kafka on your provider".</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"On GCP the design stays the same: GKE instead of EKS, Pub/Sub instead of SQS, Cloud Storage instead of S3. The one thing I'd check is GPU availability: L4s come in G2 machines, and not every region has them."</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'plataformas-ml',
        title: 'Plataformas de ML gestionadas: qué te dan y qué cobran',
        titleEn: 'Managed ML platforms: SageMaker AI, Agent Platform (Vertex AI), Azure ML',
        priority: 'extra',
        dims: ['tradeoffs', 'arquitectura', 'estimaciones'],
        blocks: [
          { t: 'p', html: `Las tres plataformas venden lo mismo: no operar servidores para entrenar, servir y registrar modelos. Son cajas de piezas; nadie usa todas. En una entrevista importa saber qué pieza resolvería qué problema y cuánto más cuesta frente a hacerlo tú.` },
          { t: 'table', caption: 'Las piezas, en cada plataforma', head: ['Pieza', 'SageMaker AI', 'Agent Platform (ex Vertex AI)', 'Azure Machine Learning'], rows: [
            ['Entrenamiento', 'Training jobs (con managed spot training)', 'Serverless training (custom training)', 'Command jobs en compute clusters o serverless compute'],
            ['Serving online', 'Real-time endpoints (varios modelos con inference components). Con inference components escalan a 0 (desde fines de 2024); al volver a arrancar tardan varios minutos y, mientras tanto, los requests fallan', 'Online inference endpoints', 'Managed online endpoints'],
            ['Asíncrono', 'Asynchronous Inference: payload por S3 hasta 1 GB, hasta 1 h, escala a 0', 'Sin un modo equivalente que yo conozca: Pub/Sub + Cloud Run o batch (verifícalo)', 'Sin equivalente directo que yo conozca: batch endpoints o una cola propia (verifícalo)'],
            ['Serverless', 'Serverless Inference: solo CPU, 1–6 GB de memoria, payload de 4 MB', 'Scale to zero en endpoints: en preview; el primer request recibe un 429 mientras escala', '—'],
            ['Batch', 'Batch Transform', 'Batch inference', 'Batch endpoints'],
            ['Pipelines', 'SageMaker Pipelines', 'Agent Platform Pipelines (KFP)', 'Azure ML pipelines'],
            ['Registry', 'Model Registry (aprobación explícita)', 'Model Registry (aliases)', 'Registries y workspaces (habla la API de MLflow)'],
            ['Feature store', 'SageMaker Feature Store', 'Agent Platform Feature Store', 'Managed feature store'],
            ['Monitoreo del modelo', 'Model Monitor', 'Model Monitoring', 'Model monitoring'],
            ['Cómo cobra la instancia', E('≈ 40 %') + ' sobre EC2 en GPU (ml.g4dn.xlarge US$0.736/h vs US$0.526), ' + E('≈ 20 %') + ' en CPU', 'Precio propio por node-hour del tipo de máquina; compáralo con Compute Engine', '"Sin cargo adicional": pagas la VM y los servicios que use (storage, Key Vault, registry)'],
          ], note: 'Los registries y pipelines se comparan en <a href="#m10.model-registry">M10</a>; serverless y sus límites con GPU, en <a href="#m06.serverless">M6</a>. Precios de instancias ml.* de la lista de precios publicada por AWS (us-east-1, hosting en tiempo real y asíncrono, oct. 2026): ml.g4dn.xlarge US$0.736/h, ml.g5.xlarge US$1.408/h, ml.c5.xlarge US$0.204/h.' },
          { t: 'h3', text: 'Los costos y límites que no están en el folleto' },
          { t: 'list', items: [
            `<b>Sobreprecio por instancia.</b> ml.g4dn.xlarge US$0.736/h contra g4dn.xlarge US$0.526/h: ${E('≈ 40 %')} más; ml.g5.xlarge US$1.408/h contra US$1.006/h, igual. En CPU, ml.c5.xlarge US$0.204/h contra ${E('≈ US$0.17/h')} en EC2: ${E('≈ 20 %')}.`,
            `<b>Cargo por GB procesado.</b> Los endpoints de tiempo real de SageMaker AI cobran "data processed in" y "data processed out": US$0.016/GB de entrada y de salida, según el medidor publicado de SageMaker Hosting (algunos ejemplos de su página de precios usan US$0.02). Con texto es nada; con imágenes es una línea grande de la factura (cálculo en <a href="#m13.managed-vs-self">la sección siguiente</a>).`,
            `<b>Límites del request.</b> <code>InvokeEndpoint</code> acepta un cuerpo de hasta 6,291,456 bytes (6 MiB) y el contenedor debe responder en 60 s. Las fotos web de c01 de hasta 10 MB no entran tal cual: o el gateway las reduce antes, o el patrón es asíncrono con el input en S3.`,
            `<b>Cuotas propias.</b> Cada tipo de instancia tiene su cuota por uso ("ml.g5.xlarge for endpoint usage", otra para training), separada de la de EC2, y en muchas cuentas arranca en 0 (<a href="#m13.cuotas-regiones">cuotas</a>).`,
            `<b>Descuentos propios.</b> Los Savings Plans de EC2 no aplican a instancias ml.*; existen SageMaker Savings Plans (AWS anuncia "hasta 64 %").`,
          ] },
          { t: 'h3', text: 'Qué le pide la plataforma a tu contenedor' },
          { t: 'p', html: `Llevar tu propio contenedor a un endpoint gestionado es posible en las tres, pero cada una impone un contrato. En SageMaker AI, el contenedor escucha en el puerto 8080 y atiende <code>POST /invocations</code> (la inferencia) y <code>GET /ping</code> (la salud); debe aceptar conexiones en 250 ms y responder en 60 s. El gateway de <a href="#c01.serving">c01</a> ya usa el 8080, pero sus rutas son <code>/v1/classify</code>, <code>/healthz</code> y <code>/readyz</code>: o agregas las dos rutas que pide la plataforma, o usas una imagen de Triton preparada para SageMaker. No es difícil; es el tipo de detalle que convierte "lo subo a SageMaker" en una semana de trabajo que nadie estimó.` },
          { t: 'p', html: `Lo que más se extraña al depurar: no puedes entrar al nodo, ver la GPU con <code>nvidia-smi</code> ni leer los eventos del scheduler. Ves los logs y métricas que la plataforma publica (CloudWatch en AWS). Cuando un cold start tarda 8 minutos, la pregunta "¿bajando la imagen, cargando el engine o esperando capacidad?" es más difícil de contestar que en tu propio cluster (<a href="#m06.cold-starts">M6</a>).` },
          { t: 'tradeoffs', items: [
            { option: 'Plataforma gestionada para servir', verdict: 'depende',
              pros: 'Autoscaling, despliegues por etapas (blue/green, canary), métricas y logs sin operar nodos ni drivers. Un equipo chico sale a producción en días.',
              cons: 'Sobreprecio por instancia y por GB, límites de payload y timeout, menos control del runtime y de la red, depurar dentro de un contenedor que no controlas, y lock-in en la forma de desplegar. Escalar a 0 existe (inference components), pero el primer request tras la pausa falla durante minutos.',
              why: 'Encaja con pocos modelos, payloads chicos y un equipo sin plataforma. Deja de encajar con imágenes o video a volumen, o cuando ya existe un cluster que alguien opera.' },
            { option: 'Plataforma gestionada para entrenar', verdict: 'elegido',
              pros: 'Pagas por segundo de job, la instancia se apaga sola al terminar, spot gestionado con checkpoints, y el registro de cada corrida queda gratis.',
              cons: 'Sobreprecio por hora y arranque de minutos por job; las GPUs grandes siguen sujetas a cuota y capacidad.',
              why: 'Para jobs esporádicos de horas (el fine-tune mensual de c01, el reentrenamiento de c04) el sobreprecio es de decenas de dólares y te ahorra mantener nodos de entrenamiento. Es la parte de estas plataformas que casi siempre conviene.' },
            { option: 'Feature store y monitoreo de la plataforma', verdict: 'depende',
              pros: 'Integrados con el endpoint y el registry.',
              cons: 'Te atan a su formato y su cobro; el monitoreo genérico no sabe qué slice importa en tu caso.',
              why: 'Úsalos si resuelven un problema que tienes (<a href="#m09.feature-store">M9</a>, <a href="#m12">M12</a>), no porque vienen en la caja.' },
          ] },
          { t: 'callout', kind: 'trap', title: 'Trampa: "la plataforma gestionada siempre tiene GPUs"', html: `<p>Las instancias ml.* salen de la misma capacidad física que EC2. Un endpoint gestionado no te salva de <code>InsufficientInstanceCapacity</code> ni de una cuota en 0; solo cambia dónde la pides.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"I'd use SageMaker AI for training jobs: per-second billing, managed spot with checkpoints, and the instance shuts down by itself. For serving, it depends on the payload: with images at ten million requests a day, the per-instance premium and the per-GB data processing fee add up, so I'd serve on the EKS cluster we already run."</p>` },
        ],
      },

      // ======================================================== 4
      {
        id: 'managed-vs-self',
        title: 'Managed vs self-hosted: la cuenta de los dos lados',
        titleEn: 'Managed vs self-hosted',
        priority: 'core',
        dims: ['tradeoffs', 'estimaciones'],
        blocks: [
          { t: 'p', html: `"Managed vs self-hosted" no se decide por gusto. Se decide con cuatro preguntas, y la primera casi siempre gana: <b>¿quién va a operar esto?</b> Un servicio gestionado cobra más por unidad y te ahorra gente; uno propio cuesta menos por unidad y te cuesta gente. Comparar solo la factura de la nube es comparar la mitad.` },
          { t: 'table', caption: 'Cuándo gana cada uno', head: ['Pregunta', 'Inclina a gestionado', 'Inclina a self-hosted'], rows: [
            ['¿Quién lo opera?', 'Equipo chico, sin plataforma, sin on-call de infraestructura', 'Ya hay un equipo de plataforma y un cluster que opera'],
            ['¿Cuánto volumen y qué payload?', 'Poco volumen o payloads chicos (texto, features)', 'Mucho volumen con payloads grandes (imágenes, video): los cobros por GB escalan con el tráfico'],
            ['¿Qué tan especial es el runtime?', 'Un contenedor estándar con un modelo', 'Triton con dynamic batching, MIG, varios modelos por GPU, red fina'],
            ['¿Qué tan rápido hay que salir?', 'Días; el producto aún no demuestra valor', 'Meses; el sistema es central y durará años'],
            ['¿Datos y cumplimiento?', 'El servicio gestionado está disponible y aprobado en la región', 'Necesitas controlar dónde y cómo se procesa cada byte'],
          ] },
          { t: 'h3', text: 'Ejemplo 1: c01, Triton en EKS vs un endpoint de SageMaker AI' },
          { t: 'p', html: `Mismo diseño de <a href="#c01.arquitectura">c01</a>, mismas 2 T4 por N+1. Lo único que cambia es dónde corre el tier de GPU. El gateway, el ALB, los logs y el control plane de EKS (el gateway sigue corriendo en el cluster) quedan iguales en los dos lados (${E('≈ US$924/mes')}); para no castigar al lado gestionado, supongo que el gateway manda el tensor en UINT8 (150,528 B, la palanca de <a href="#c01.costo">c01</a>) y no en FP32.` },
          { t: 'calc', title: 'Tier de GPU de c01, al mes (730 h, on-demand)', rows: [
            { label: 'Self-hosted: 2 × g4dn.xlarge', expr: '2 × 0.526 × 730', value: E('≈ US$768') },
            { label: 'Gestionado: 2 × ml.g4dn.xlarge', expr: '2 × 0.736 × 730', value: E('≈ US$1,075') },
            { label: 'GB que entran al endpoint', expr: '304 M requests × 150,528 B', value: '≈ 45,760 GB/mes' },
            { label: 'Data processed in + out', expr: '45,760 × 0.016 + ≈ 304 GB × 0.016', value: E('≈ US$737') },
            { label: 'Interface endpoint para llamar a SageMaker desde la VPC', expr: '≈ 46,064 GB × 0.01 + 2 AZ × 0.01 × 730', value: E('≈ US$475') },
            { label: 'Gestionado, total del tier', expr: '1,075 + 737 + 475', value: E('≈ US$2,287') },
            { label: 'Infra completa: self-hosted vs gestionado', expr: '768 + 924 vs 2,287 + 924', value: E('≈ US$1.7k vs ≈ US$3.2k') },
          ], result: 'Con imágenes a 10 M/día, el lado gestionado cuesta ≈ 1.9× la infra completa; casi todo lo que agrega son cobros por GB, no el sobreprecio de la instancia. Con el tensor en FP32 (602 KB) el data processed solo serían ≈ US$2.9k/mes; llamando por el NAT en vez del interface endpoint, ≈ US$2.1k en lugar de US$475. Por eso c01 sirve en EKS: la empresa ya opera el cluster.' },
          { t: 'callout', kind: 'senior', title: 'Señal senior: la misma cuenta con otro equipo', html: `<p>Si el enunciado dijera "somos tres personas y no hay Kubernetes", la diferencia de ${E('≈ US$1.5k/mes')} es una fracción de lo que cuesta una persona dedicada a operar EKS, drivers y autoscaling de nodos. Ahí la respuesta pragmática es el endpoint gestionado, y lo revisas cuando el tráfico o la cantidad de modelos lo justifique. Pero la cuenta cambia: sin Kubernetes, el preproceso va dentro del contenedor del endpoint (o el gateway pasa a ECS o Fargate), y si va dentro, el data processed se cobra sobre el JPEG: ${E('≈ 61 TB × US$0.016 ≈ US$1k/mes')}. Es lo mismo que dice <a href="#m06.por-que-k8s">M6</a>: decide quién opera.</p>` },
          { t: 'h3', text: 'Ejemplo 2: c05, Textract vs un OCR propio' },
          { t: 'p', html: `<a href="#c05.costo">c05</a> manda ${E('≈ 186k páginas/mes')} a un OCR gestionado: Amazon Textract, solo detección de texto (US$1.50 por 1,000 páginas hasta 1 M al mes; US$0.60 por encima). La alternativa: un modelo de OCR open source servido por ti. No tengo un benchmark confiable de throughput de OCR para estos documentos, ni en GPU ni en CPU. La versión que se suele proponer es "en GPU", y a este volumen cualquier GPU estaría casi ociosa. Pero el pico de c05 es ≈ 0.6 páginas/s: si un benchmark confirma que el OCR corre en CPU, cabe en pocos núcleos, y la comparación justa es contra CPU.` },
          { t: 'calc', title: 'OCR gestionado vs propio (on-demand)', rows: [
            { label: 'Textract, detección de texto', expr: '186,000 × 1.50 ÷ 1,000', value: E('≈ US$279/mes') },
            { label: 'OCR propio en GPU: 2 × g4dn.xlarge por disponibilidad', expr: '2 × 0.526 × 730', value: E('≈ US$768/mes'), note: 'Más evaluación en el gold set, manuscritos, parches y on-call' },
            { label: 'OCR propio en CPU (si el benchmark lo confirma): 2 × c6i.xlarge', expr: '2 × 0.17 × 730', value: E('≈ US$248/mes'), note: 'Empata con Textract; en el pool de <code>doc-worker</code> el costo marginal puede ser aún menor' },
            { label: 'Punto de equilibrio solo con la factura, en GPU', expr: '768 ÷ 1.50 × 1,000', value: '≈ 512k páginas/mes', note: '2.75× el volumen de c05; en CPU, ≈ 165k: ya lo cruzas' },
            { label: 'Equilibrio sumando ' + E('≈ US$2.5k/mes') + ' de ingeniería (¼ de persona)', expr: '1.50 × 1 M + 0.60 × (p − 1 M) = 2,748 (CPU) … 3,268 (GPU)', value: E('≈ 3.1–3.9 M páginas/mes'), note: '≈ 17–21× el volumen de c05' },
          ], result: 'A este volumen, Textract gana, pero no por la factura: un OCR propio en CPU costaría lo mismo, y solo en GPU pierde también en dinero. Gana por lo que no está en la factura: evaluar, mantener y operar otro modelo, y la calidad en casos difíciles. El OCR es ≈ 3 % del costo de c05 (las personas son ≈ 80–90 %). Un OCR propio empieza a tener sentido con millones de páginas al mes, o si el gestionado no cubre lo que necesitas (por ejemplo, manuscrita en español: <a href="#c05.tradeoffs">c05</a>).' },
          { t: 'callout', kind: 'trap', title: 'Trampa: comparar el precio unitario sin la utilización', html: `<p>"Textract cuesta US$1.50 por 1,000 páginas y en una GPU propia la página sale a fracciones de centavo" compara el costo marginal de una GPU llena con el precio de lista de un servicio que cobra solo lo que usas. Tu GPU no está llena: está encendida 730 horas para procesar 0.07 páginas por segundo en promedio. Es la misma trampa del costo por predicción de <a href="#m04.costo-por-prediccion">M4</a>.</p>` },
          { t: 'tradeoffs', items: [
            { option: 'c01: Triton en EKS (self-hosted)', verdict: 'elegido', pros: 'Más barato por unidad a este volumen; control de Triton (dynamic batching, ruteo por zona); reutiliza la plataforma existente.', cons: 'Exige un equipo que opere nodos GPU, drivers y autoscaling.', why: 'La empresa ya opera EKS (<a href="#c01.tradeoffs">c01</a>) y el payload es grande.' },
            { option: 'c01: endpoint de SageMaker AI', verdict: 'descartado', pros: 'Sin nodos que operar; canary y autoscaling incluidos.', cons: 'Cobros por GB que escalan con el tráfico de imágenes, payload ≤ 6 MiB, ≈ 1.9× la infra.', why: 'Sería la opción por defecto sin equipo de plataforma.' },
            { option: 'c05: Textract (gestionado)', verdict: 'elegido', pros: 'Paga por página, sin GPU ociosa, sin operar nada; misma cuenta y región.', cons: 'Dependencia del proveedor; manuscrita en español sin soporte documentado.', why: 'El OCR es ≈ 3 % del costo; el valor está en el STP y la revisión humana.' },
          ] },
          { t: 'callout', kind: 'interview', html: `<p>"The managed option costs more per unit and saves people; self-hosting costs less per unit and needs people. For the image classifier, the platform team already exists and the per-GB fees would roughly double the bill, so we self-host. For OCR on the loan documents it's the opposite: at under two hundred thousand pages a month, Textract is a few hundred dollars. Our own OCR would cost about the same on CPUs, or more on an idle GPU, and it needs someone to maintain it."</p>` },
        ],
      },

      // ======================================================== 5
      {
        id: 'gpus-precios',
        title: 'Instancias GPU y costo por hora',
        titleEn: 'GPU instances and cost per hour',
        priority: 'extra',
        dims: ['estimaciones', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Las specs de cada GPU (memoria, ancho de banda, BF16/FP8) y por qué elegir una u otra están en <a href="#m04.gpus-nvidia">M4</a>. Aquí va lo de la nube: en qué instancia viene cada GPU, cuántas trae y cuánto cuesta la hora. Precios on-demand aproximados de us-east-1 (los de AWS, iguales a la <a href="#ref-numeros.gpus">hoja de números</a>); verifícalos antes de un documento real.` },
          { t: 'table', caption: 'AWS: familias por GPU (us-east-1, on-demand, oct. 2026)', head: ['Familia', 'GPU · memoria', 'GPUs por instancia', 'La más chica', 'US$/h la más chica', 'US$ por GPU-hora en la grande'], rows: [
            ['g4dn', 'T4 · 16 GB', '1 (xlarge a 16xlarge), 4 (12xlarge), 8 (metal)', 'g4dn.xlarge: 4 vCPU, 16 GiB', E('≈ 0.526'), 'g4dn.12xlarge: ' + E('≈ 3.91 ÷ 4 ≈ 0.98')],
            ['g5', 'A10G · 24 GB', '1, 4 (12xlarge, 24xlarge), 8 (48xlarge)', 'g5.xlarge: 4 vCPU, 16 GiB', E('≈ 1.006'), '—'],
            ['g6', 'L4 · 24 GB', '1, 4 (12xlarge, 24xlarge), 8 (48xlarge)', 'g6.xlarge: 4 vCPU, 16 GiB', E('≈ 0.805'), 'g6.12xlarge: ' + E('≈ 4.60 ÷ 4 ≈ 1.15')],
            ['g6e', 'L40S · 48 GB', '1, 4, 8', 'g6e.xlarge: 4 vCPU, 32 GiB', E('≈ 1.861'), '—'],
            ['p4d / p4de', 'A100 · 40 / 80 GB', '8 (no hay tamaños chicos)', 'p4d.24xlarge', E('≈ 21.96'), E('≈ 2.75')],
            ['p5', 'H100 · 80 GB', '1 (p5.4xlarge) u 8 (p5.48xlarge)', 'p5.4xlarge', E('≈ 6.88'), E('≈ 55.04 ÷ 8 ≈ 6.88')],
          ], note: 'Precios de agregadores públicos y de la página de EC2; AWS bajó P4 y P5 hasta 45 % en junio de 2025. g6.2xlarge (1 L4, 8 vCPU, 32 GiB) ≈ US$0.98/h es la de <a href="#c04.estimaciones">c04</a>: más CPU para decodificar tiles.' },
          { t: 'table', caption: 'Equivalentes en Google Cloud y Azure (precio de lista aproximado, verifícalo)', head: ['GPU', 'Google Cloud', 'US$/h', 'Azure', 'US$/h'], rows: [
            ['T4', 'n1-standard-4 + 1 T4 (la GPU se agrega a la VM)', E('≈ 0.19 + 0.35 ≈ 0.54'), 'NC4as_T4_v3', E('≈ 0.53')],
            ['L4', 'g2-standard-4', E('≈ 0.71'), 'Sin una serie NC con L4 que yo conozca', '—'],
            ['A100', 'a2-highgpu-1g (40 GB)', E('≈ 3.67'), 'NC24ads_A100_v4 (80 GB)', E('≈ 3.67')],
            ['H100', 'a3-highgpu-1g', E('≈ 11'), 'NC40ads_H100_v5 (H100 NVL, 94 GB)', E('≈ 6.98')],
          ], note: 'GCP en us-central1, Azure en East US, Linux, de agregadores públicos (oct. 2026). La misma GPU puede costar distinto entre nubes: la H100 de lista en GCP ronda 1.6× la de AWS tras el recorte de 2025. No hay una nube "barata": hay precios por GPU y por región.' },
          { t: 'h3', text: 'Por qué la instancia más chica con tu GPU suele ganar en inferencia' },
          { t: 'calc', title: 'US$ por GPU-hora según el tamaño de la instancia', rows: [
            { label: 'T4 en g4dn.xlarge', expr: '0.526 ÷ 1', value: E('≈ US$0.53') },
            { label: 'T4 en g4dn.12xlarge', expr: '3.912 ÷ 4', value: E('≈ US$0.98'), note: '≈ 1.9× por GPU: pagas 48 vCPU, 192 GiB y 50 Gb/s de red' },
            { label: 'L4 en g6.xlarge', expr: '0.805 ÷ 1', value: E('≈ US$0.80') },
            { label: 'L4 en g6.12xlarge', expr: '4.60 ÷ 4', value: E('≈ US$1.15'), note: '≈ 1.4× por GPU' },
          ], result: 'En AWS, la instancia grande no es más barata por GPU: suele ser más cara, porque trae CPU, RAM y red pensadas para entrenamiento multi-GPU. Para servir un modelo que cabe en una GPU, la instancia de una GPU gana.' },
          { t: 'list', items: [
            '<b>Granularidad de N+1.</b> Con instancias de 1 GPU, la réplica de respaldo de c01 es una T4 (US$384/mes). Con instancias de 4, el "más uno" son cuatro GPUs, o meter las dos réplicas en la misma máquina, que no es N+1.',
            '<b>Dominio de falla.</b> Si se cae una instancia de 4 GPUs, pierdes 4 réplicas a la vez y el resto del pool recibe el golpe.',
            '<b>Autoscaling.</b> Escalar GPU por GPU sigue la curva diaria; escalar de cuatro en cuatro deja capacidad ociosa en cada escalón.',
          ] },
          { t: 'callout', kind: 'note', title: 'Cuándo sí conviene la instancia grande', html: `<p>(1) El modelo no cabe en una GPU y lo partes con tensor parallelism, que pide NVLink entre GPUs: es el caso de los LLM grandes (<a href="#m14">M14</a>). (2) Entrenamiento multi-GPU, donde la red entre GPUs manda. (3) El preproceso necesita mucha CPU por GPU: ahí subes de tamaño sin subir de GPUs, como la g6.2xlarge de c04 (8 vCPU con 1 L4), no a una de 4 GPUs.</p>` },
          { t: 'h3', text: 'Fuera de la tabla: aceleradores propios y nubes de GPUs' },
          { t: 'p', html: `Dos alternativas que un entrevistador puede sacar. (1) <b>Aceleradores de la propia nube</b>: AWS Inferentia (instancias inf2) y las TPUs de Google. Pueden bajar el costo por predicción, a cambio de compilar el modelo con su SDK y de atarte a esa nube; se evalúan con el mismo load test que una GPU (<a href="#m04.cpu-gpu-tpu">M4</a>). (2) <b>Proveedores especializados en GPUs</b>: suelen cobrar menos por GPU-hora que las nubes grandes en GPUs de entrenamiento. El costo que no aparece en su precio es mover los datos: entrenar ahí con un dataset de 50 TB en S3 paga ${E('≈ US$4.3k')} de egress por cada copia (<a href="#m13.costos-ocultos">costos ocultos</a>), más otra cuenta que asegurar y auditar. Tiene sentido para entrenamientos grandes y esporádicos, rara vez para el serving de un sistema que vive en tu nube.` },
          { t: 'callout', kind: 'trap', title: 'Trampa: elegir por US$ por hora', html: `<p>La T4 es la hora más barata y la L4 puede ser la predicción más barata si el load test confirma ≈ 2–3× el throughput. Con c01 a su carga actual (2 GPUs por N+1 casi ociosas) gana la T4; a 10× gana la L4 (<a href="#m04.costo-por-prediccion">M4</a>). Di el precio por hora y luego el costo por 1,000 predicciones con tu utilización real.</p>` },
          { t: 'callout', kind: 'skip', html: `<p>No memorices los tamaños intermedios (2xlarge, 4xlarge…) ni los precios de GCP y Azure. Memoriza: T4 ≈ US$0.53/h, L4 ≈ US$0.80/h, A10G ≈ US$1/h, A100 ≈ US$3 por GPU-hora (≈ 2.75 en AWS, donde viene en grupos de 8), H100 ≈ US$7 por GPU-hora en AWS.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"For inference I pick the smallest instance with the GPU I need: a g4dn.xlarge with one T4 at about fifty cents an hour. The 4-GPU sizes cost more per GPU and make the spare replica four GPUs instead of one. I only go bigger if the model doesn't fit on one GPU or the preprocessing needs more CPU per GPU."</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'spot',
        title: 'Spot y preemptible: para qué sí y para qué no',
        titleEn: 'Spot and preemptible instances',
        priority: 'core',
        dims: ['tradeoffs', 'estimaciones'],
        blocks: [
          { t: 'p', html: `Spot es capacidad sobrante que la nube vende con descuento y puede recuperar cuando la necesita. La pregunta de diseño no es "¿cuánto ahorro?" sino "¿qué le pasa a mi sistema cuando me quitan la máquina con segundos de aviso?". Si la respuesta es "repito un pedazo de trabajo", spot sirve. Si es "un usuario ve un error", no.` },
          { t: 'table', caption: 'Mecánica de la interrupción por nube', head: ['', 'AWS (Spot Instances)', 'Google Cloud (Spot VMs)', 'Azure (Spot VMs)'], rows: [
            ['Aviso', '2 minutos, por EventBridge y metadata de la instancia (<code>spot/instance-action</code>); "best effort"', 'Señal en la metadata (<code>preempted</code>) y luego un apagado de hasta 30 s ("best effort"); hay un aviso de 120 s en preview', 'Evento <code>Preempt</code> en Scheduled Events, con un aviso mínimo de 30 s ("best effort")'],
            ['Señal temprana', 'Rebalance recommendation: riesgo elevado, a veces antes del aviso', '—', '—'],
            ['Descuento anunciado', '"Hasta 90 %"', '"Hasta 91 %"', '"Hasta 90 %"'],
            ['Duración máxima', 'Sin límite fijo', 'Sin límite fijo (las preemptible VMs viejas duraban 24 h)', 'Sin límite fijo'],
            ['Precio', 'Varía con la oferta y la demanda, por tipo y por zona', 'Varía (como mucho, un cambio por día)', 'Varía; puedes fijar un precio máximo'],
          ], note: 'Fuentes: documentación de EC2, Compute Engine y Azure (oct. 2026). En Kubernetes, Karpenter escucha los avisos de AWS con una cola de interrupciones, drena el nodo y lanza el reemplazo (<a href="#m06.nodos">M6</a>).' },
          { t: 'table', caption: 'Lo anunciado vs lo observado: precio spot en us-east-1 (consulta puntual, oct. 2026)', head: ['Instancia', 'On-demand', 'Spot', 'Descuento'], rows: [
            ['g4dn.xlarge (T4)', '0.526', E('≈ 0.27'), E('≈ 48 %')],
            ['g5.xlarge (A10G)', '1.006', E('≈ 0.46'), E('≈ 54 %')],
            ['g6.xlarge (L4)', '0.805', E('≈ 0.60'), E('≈ 25 %')],
            ['g6e.xlarge (L40S)', '1.861', E('≈ 1.84'), E('≈ 1 %')],
            ['p5.48xlarge (8 × H100)', '55.04', E('≈ 21.5'), E('≈ 61 %')],
          ], note: 'Una foto de un agregador público (instances.vantage.sh), no un promedio: cambia por zona y por hora. Otro agregador mostraba para g6.xlarge una frecuencia de interrupción de más de 20 %. Míralo tú con <code>describe-spot-price-history</code> y el Spot Instance Advisor (<a href="#m13.cuotas-regiones">comandos</a>).' },
          { t: 'callout', kind: 'trap', title: 'Trampa: "spot ahorra 90 %"', html: `<p>El 90 % es un techo publicitario. En GPUs populares, el descuento real puede ser de 25–55 % y en algunas, casi nulo (la g6e de la tabla). Y el descuento no es el ahorro: hay que restar el trabajo que se repite tras cada interrupción. Cuando el curso usa ${E('60–70 %')} (c01, c02 y c04) es un supuesto, marcado así allí y en la <a href="#ref-numeros.costos">hoja de números</a>, que se confirma con el historial de precios.</p>` },
          { t: 'h3', text: 'Qué va en spot' },
          { t: 'table', head: ['Carga', '¿Spot?', 'Por qué', 'Lo que necesita'], rows: [
            ['Entrenamiento y fine-tuning', 'Sí', 'Una interrupción cuesta lo que pasó desde el último checkpoint', 'Checkpoints frecuentes a S3; reanudar desde el último (<a href="#m10.pipelines-entrenamiento">M10</a>)'],
            ['Batch y asíncrono (c04)', 'Sí, con fallback', 'El mensaje vuelve a la cola y otro worker lo toma', 'Jobs idempotentes, visibility timeout, SIGTERM que deja de tomar mensajes (<a href="#c04.serving">c04</a>)'],
            ['Backfills y reprocesos', 'Sí', 'Shards que se reintentan', 'Checkpoint por shard (<a href="#m02.batch">M2</a>)'],
            ['CI, load tests, notebooks', 'Sí', 'Nadie depende de ellos en tiempo real', 'Que el job falle limpio y se reintente'],
            ['El mínimo de un servicio online (c01)', 'No', 'Perder una de dos réplicas deja al servicio sin N+1 con 2 min de aviso', 'On-demand, con reserva de capacidad si es crítico'],
            ['Réplicas de ráfaga de un servicio online', 'Con cuidado', 'Si se van, vuelves a la base on-demand y al fallback', 'Base que cubra el SLO sola; diversificar tipos y zonas'],
          ] },
          { t: 'steps', items: [
            { title: 'Detectar el aviso', meta: 'segundos', html: '<p>En Kubernetes lo hace el autoscaler de nodos (Karpenter con su cola de interrupciones) o un handler de terminación: marca el nodo y lo drena. Fuera de Kubernetes, tu proceso consulta la metadata o recibe el evento.</p>' },
            { title: 'Dejar de tomar trabajo', meta: 'SIGTERM', html: '<p>El pod recibe SIGTERM: el worker de <a href="#c04.serving">c04</a> deja de pedir mensajes a la cola; un servidor online sale de readiness para que el balanceador deje de mandarle requests.</p>' },
            { title: 'Guardar o devolver', meta: 'antes del corte', html: '<p>Entrenamiento: checkpoint si cabe en el aviso (en GCP y Azure, 30 s rara vez alcanzan: por eso el checkpoint es periódico, no al final). Batch: no confirmar el mensaje a medio procesar, que vuelve a la cola al vencer su visibility timeout.</p>' },
            { title: 'Reanudar en otro nodo', meta: 'minutos', html: '<p>El orquestador relanza el job desde el último checkpoint, o otro worker toma el mensaje. Si es idempotente (la clave de c04: sha256 + model_version + config), repetir no duplica resultados.</p>' },
          ] },
          { t: 'p', html: `El patrón mixto: <b>base on-demand que cumple el SLO sola + ráfaga en spot</b>. Pero haz la cuenta antes de venderlo: en c01, la ráfaga es poca y el dinero está en la base.` },
          { t: 'calc', title: 'Tres cuentas de spot', rows: [
            { label: 'Fine-tune de 40 h en g5.xlarge, on-demand', expr: '40 × 1.006', value: E('≈ US$40') },
            { label: 'El mismo en spot: 4 interrupciones, checkpoint cada 30 min', expr: '(40 + 4 × 25 min) × 0.462', value: E('≈ US$19 (≈ 52 % menos)'), note: 'Cada interrupción pierde ≈ 15 min (mitad del intervalo) + ≈ 10 min de reinicio' },
            { label: 'c04: workers g6.2xlarge, facturados al mes', expr: '450 h × 0.98', value: E('≈ US$441') },
            { label: 'c04 en spot, según el descuento real', expr: '441 × 25 % … 441 × 70 %', value: E('≈ US$110–309 de ahorro'), note: 'El mismo rango que usa c04; con el ≈ 25 % observado en g6, el extremo bajo' },
            { label: 'c01: 2 réplicas de ráfaga, ≈ 4 h al día', expr: '2 × 4 × 30 = 240 h × 0.526', value: E('≈ US$126/mes') },
            { label: 'c01: esa ráfaga en spot (≈ 48 %)', expr: '126 × 0.48', value: E('≈ US$60/mes de ahorro'), note: 'Contra ≈ US$300–400 de un compromiso sobre la base (<a href="#m13.compromisos">compromisos</a>)' },
          ], result: 'Spot rinde donde hay muchas horas interrumpibles (entrenamiento, batch); en un servicio online chico, la ráfaga es poca y el ahorro grande está en comprometer la base.' },
          { t: 'callout', kind: 'senior', title: 'Señal senior: diversificar y dimensionar el checkpoint', html: `<p>Dos detalles que separan a quien usó spot de quien leyó sobre él. (1) <b>Diversificar</b>: varios tipos de instancia compatibles y varias zonas, con una estrategia de asignación que pondere precio y capacidad (en AWS, <code>price-capacity-optimized</code>). Pero la diversificación la limita el artefacto: un engine de TensorRT compilado para T4 no corre en una L4 (<a href="#m06.nodos">M6</a>). (2) <b>El intervalo de checkpoint</b> equilibra el costo de escribirlo contra el trabajo perdido: con interrupciones cada pocas horas, cada 15–30 min suele bastar; con checkpoints de decenas de GB, mídelo.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"Training and the batch workers run on spot: training checkpoints to S3 every thirty minutes, and a batch job that loses its node just goes back to the queue. The online minimum stays on-demand, because losing one of two replicas with two minutes of notice leaves us without N+1. I'd check the spot price history before promising a number: for some GPU types the discount is closer to a quarter than to ninety percent."</p>` },
        ],
      },

      // ======================================================== 7
      {
        id: 'costos-ocultos',
        title: 'Costos ocultos: recorre los bytes',
        titleEn: 'Hidden costs: egress, NAT, cross-AZ, LCUs, logs, requests, idle GPUs',
        priority: 'core',
        dims: ['estimaciones', 'arquitectura'],
        blocks: [
          { t: 'p', html: `Las GPUs se ven en el diseño porque las dibujaste. Los costos ocultos no se dibujan: viven en las flechas. La técnica es siempre la misma: <b>recorre cada byte</b> (quién lo mueve, cuántas veces, por dónde) y <b>cada hora encendida</b> (¿trabaja o espera?). En c01, las GPUs son ≈ 45 % de la infra; el ALB, ≈ 30 %.` },
          { t: 'diagram', id: 'red-costos-c01', title: 'Dónde cobra la red en c01', caption: 'La arquitectura de c01 vista desde la factura, con dos caminos caros para comparar (punteados: el cruce de AZ y el pull por el NAT). Toca cada caja para ver su tarifa y recorre los cuatro flujos.', spec: RED },
          { t: 'table', caption: 'El mapa de los costos ocultos (AWS, us-east-1)', head: ['Concepto', 'Tarifa', 'Dónde aparece', 'Antídoto'], rows: [
            ['Egress a internet', E('≈ US$0.09/GB') + ' los primeros 10 TB/mes (luego 0.085, 0.07, 0.05); 100 GB/mes gratis', 'Devolver imágenes o video; entrenar en otro proveedor con datos en S3', 'Procesar donde están los datos; CDN para contenido público'],
            ['NAT gateway', 'US$0.045/h + US$0.045/GB', 'Pulls de imágenes, pesos y datasets desde subredes privadas', 'Gateway endpoint de S3 (gratis; por ahí bajan también las capas de ECR); interface endpoints <code>ecr.api</code> y <code>ecr.dkr</code> (≈ US$0.01/h por zona; solo manifiestos y API); espejar en ECR'],
            ['Cruce de AZ', 'US$0.01/GB en cada sentido', 'Service sin ruteo por zona; Kafka autogestionado replicando entre zonas', 'Ruteo por zona; mantener cada salto en su zona'],
            ['Entre regiones', E('≈ US$0.02/GB') + ' desde us-east-1', 'Réplicas de DR, multi-región', 'Replicar solo lo que exige el requisito'],
            ['ALB', 'US$0.0225/h + US$0.008 por LCU-h', 'Payloads grandes por el balanceador', 'Mandar referencias (key de S3) en vez de bytes, si el p99 lo aguanta'],
            ['CloudWatch Logs', 'US$0.50/GB al ingerir + US$0.03/GB-mes', 'Logs de debug, payloads en el log', 'Logs de predicción a S3; niveles y muestreo'],
            ['Requests de S3', 'US$0.005 por 1,000 PUT; US$0.0004 por 1,000 GET', 'Millones de objetos chicos', 'Agrupar en archivos grandes (Parquet, shards)'],
            ['GPU ociosa', 'La hora completa', 'Cooldowns, mínimos, staging encendido', 'Escalar a cero donde el SLO lo permite; apagar fuera de horario'],
            ['Control plane de EKS en soporte extendido', 'US$0.60/h en vez de US$0.10/h', 'Clusters que no se actualizan', 'Mantener la versión de Kubernetes en soporte estándar'],
            ['IPv4 públicas', 'US$0.005/h cada una (desde 2024)', 'Nodos con IP pública "por comodidad"', 'Subredes privadas; IPv6 donde se pueda'],
          ] },
          { t: 'h3', text: 'Las cuentas, una por una' },
          { t: 'calc', title: 'Red: egress, NAT y cruce de AZ', rows: [
            { label: 'Egress: copiar un dataset de 50 TB de S3 a otro proveedor de GPUs', expr: '10 TB × 0.09 + 40 TB × 0.085 (− 100 GB gratis)', value: E('≈ US$4.3k por copia'), note: 'Cada vez que lo copias. Entrena donde están los datos, o mueve los datos una vez' },
            { label: 'NAT: c04 descargando los WSI por el NAT', expr: '1,200 × 1 GB × 30 = 36 TB × 0.045', value: E('≈ US$1,620/mes'), note: '≈ 3.7× lo que cuestan sus GPUs (≈ US$441)' },
            { label: 'Los mismos WSI por el gateway endpoint de S3', expr: '36 TB × 0', value: 'US$0' },
            { label: 'NAT: imagen de Triton de 9.2 GB, ≈ 60 arranques al mes', expr: '9.2 × 60 × 0.045', value: E('≈ US$25/mes'), note: 'Chico: el NAT duele con lo que se mueve todos los días, no con lo esporádico' },
            { label: 'Cruce de AZ: c01 sin ruteo por zona', expr: '≈ 90 TB × 0.02', value: E('≈ US$1,800/mes'), note: 'Más que las dos GPUs (<a href="#c01.costo">c01</a>)' },
            { label: 'Cruce de AZ: Kafka autogestionado, RF 3 en 3 AZs, ≈ 5.5 TB/mes de eventos', expr: '(2 réplicas + ⅔ productor + ⅔ × 2 grupos de consumo) × 5.5 TB × 0.02', value: E('≈ US$438/mes'), note: 'Eventos de ≈ 1 KB en un sistema como c06. Amazon MSK no cobra la replicación entre brokers: quedaría ≈ US$219 de clientes' },
          ], result: 'El patrón: un costo por GB de centavos se vuelve grande cuando multiplica algo que pasa millones de veces al día o terabytes al mes. Los dos antídotos más baratos de toda la nube son el ruteo por zona y el gateway endpoint de S3.' },
          { t: 'calc', title: 'Balanceador, logs y requests', rows: [
            { label: 'ALB de c01: GB por hora', expr: '≈ 2 TB/día × 30.4 ÷ 730', value: '≈ 83 GB/h ≈ 83 LCUs' },
            { label: 'ALB de c01: total', expr: '83 × 0.008 × 730 + 0.0225 × 730', value: E('≈ US$503/mes') },
            { label: 'Logs de c01 en CloudWatch (≈ 300 B por predicción)', expr: '3 GB/día × 30.4 × 0.50', value: E('≈ US$46/mes'), note: 'Barato; c01 igual los manda a S3 porque los va a consultar en lote' },
            { label: 'Un log de debug con ≈ 5 KB por request en c01', expr: '304 M × 5 KB = 1,520 GB × 0.50', value: E('≈ US$760/mes'), note: 'Un flag de debug olvidado cuesta 2 T4' },
            { label: 'c06: ≈ 1 KB por ítem moderado, a CloudWatch', expr: '180 M × 1 KB × 30.4 = 5,472 GB × 0.50', value: E('≈ US$2.7k/mes') },
            { label: 'Lo mismo a S3 (solo almacenamiento del mes)', expr: '5,472 GB × 0.023', value: E('≈ US$126/mes') },
            { label: 'c04 guardando cada tile como un objeto', expr: '3.6 M PUT/día × 30.4 ÷ 1,000 × 0.005', value: E('≈ US$547/mes'), note: 'Solo los PUT; leerlos una vez suma ≈ US$44' },
            { label: 'c04 leyendo cada WSI con ≈ 125 GETs por rango (partes de 8 MB)', expr: '1,200 × 125 × 30.4 ÷ 1,000 × 0.0004', value: E('≈ US$2/mes') },
          ], result: 'Mismo volumen de datos, costos de 100× de diferencia según el servicio y el tamaño de los objetos. c04 guarda un GeoJSON y un PNG por lámina, no un objeto por tile.' },
          { t: 'calc', title: 'Horas facturadas vs horas trabajando', rows: [
            { label: 'c04: GPU trabajando', expr: '8.3 h/día × 30 × 0.98', value: E('≈ US$244/mes') },
            { label: 'c04: GPU facturada (cooldown de 15 min, una lámina cada ≈ 42 s)', expr: '15 h/día × 30 × 0.98', value: E('≈ US$441/mes') },
            { label: 'Fracción ociosa de c04', expr: '1 − 244 ÷ 441', value: E('≈ 45 %'), note: 'Aceptable: un cooldown más corto apagaría y prendería el nodo entre láminas, con minutos de cold start' },
            { label: 'Staging de c01 con 1 T4 encendida 24/7', expr: '0.526 × 730', value: E('≈ US$384/mes'), note: 'Prenderla 60 h/semana ahorra ≈ 64 % (<a href="#c01.costo">c01</a>)' },
            { label: 'Un cluster de EKS que se quedó en soporte extendido', expr: '(0.60 − 0.10) × 730', value: E('≈ US$365/mes de más') },
            { label: '20 nodos con IP pública "por comodidad"', expr: '20 × 0.005 × 730', value: E('≈ US$73/mes') },
          ], result: 'La nube cobra la hora encendida, no la hora útil. "Facturado vs ocupado" es la pregunta para cada GPU del diseño.' },
          { t: 'h3', text: 'Cómo encontrarlos antes que la factura' },
          { t: 'list', ordered: true, items: [
            '<b>Bytes por request × requests por mes</b>, para cada flecha del diagrama. Si una flecha mueve terabytes al mes, pregúntale por dónde pasa: balanceador, otra zona, NAT, otro servicio que cobre por GB.',
            '<b>Horas encendidas vs horas útiles</b> para cada nodo con GPU: mínimos, cooldowns, staging, CI.',
            '<b>Etiquetas de costo</b> por modelo, equipo y entorno desde el día 1; sin ellas, la factura dice "EC2" y nadie sabe de quién es.',
            '<b>Presupuestos con alerta</b> (AWS Budgets o el equivalente) y una revisión mensual. En Cost Explorer, agrupando por tipo de uso, el NAT aparece como <code>NatGateway-Bytes</code> y el cruce de AZ como <code>DataTransfer-Regional-Bytes</code>: casi nunca bajo el servicio que los causó.',
          ] },
          { t: 'callout', kind: 'trap', title: 'Trampa: el NAT gateway como salida por defecto', html: `<p>Todos los nodos en subredes privadas salen a internet por el NAT, y por inercia también van por ahí a S3, a ECR y a Docker Hub. Nadie lo nota hasta la factura: el NAT aparece como "NAT gateway data processing", no bajo S3. Y sin el gateway endpoint de S3, un pull de ECR desde una subred privada sin NAT falla: los endpoints de ECR solo entregan el manifiesto, y las capas se descargan de S3. En la entrevista basta una frase: "S3 through a gateway endpoint; ECR through its interface endpoints plus that same S3 endpoint, because the image layers live in S3. Model weights and images never go through the NAT."</p>` },
          { t: 'callout', kind: 'trap', title: 'Trampa: un solo NAT para todas las zonas', html: `<p>Un NAT por cuenta "para ahorrar" hace que el tráfico de las otras zonas además cruce de AZ, y si esa zona cae, todas pierden salida. El diseño estándar es un NAT por zona (<a href="#m06.alta-disponibilidad">M6</a>), y lo pesado no pasa por ninguno.</p>` },
          { t: 'callout', kind: 'senior', html: `<p>La señal senior aquí es preguntar <b>por el payload</b> antes que por la GPU: "¿cuántos bytes por request y a dónde van?". Con eso salen el ALB, el cruce de AZ, el data processed de un endpoint gestionado y el NAT. Una etiqueta de costo por modelo o por equipo (cost allocation tags) convierte esas líneas sueltas en "este modelo cuesta X al mes".</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"Beyond the GPUs, I'd follow the bytes. The photos cross the load balancer, which bills per gigabyte: about five hundred dollars a month. The tensors stay in their zone thanks to zone-aware routing, otherwise that's eighteen hundred more. Weights come from S3 through a gateway endpoint, never through the NAT. And prediction logs go to S3, not to CloudWatch."</p>` },
        ],
      },

      // ======================================================== 8
      {
        id: 'compromisos',
        title: 'Compromisos: reservas, Savings Plans y CUDs',
        titleEn: 'Reserved instances, Savings Plans and committed use discounts',
        priority: 'extra',
        dims: ['estimaciones', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Un compromiso cambia flexibilidad por precio: prometes pagar cierto uso durante 1 o 3 años, se use o no, y a cambio la hora sale más barata. Los mecanismos tienen nombres distintos en cada nube, pero la decisión es una sola: <b>¿qué parte de mi uso estoy seguro de que existirá todo el año?</b>` },
          { t: 'table', caption: 'Los mecanismos (descuentos máximos anunciados, oct. 2026)', head: ['Mecanismo', 'Nube', 'Qué comprometes', 'Descuento máximo anunciado', 'Flexibilidad'], rows: [
            ['Reserved Instances', 'AWS', 'Un tipo de instancia en una región (o zona) por 1 o 3 años', '"Hasta 72 %"', 'Baja: atado al tipo'],
            ['Compute Savings Plans', 'AWS', 'US$/hora de gasto en cómputo por 1 o 3 años', '"Hasta 66 %"', 'Alta: cualquier familia, región, Fargate y Lambda'],
            ['EC2 Instance Savings Plans', 'AWS', 'US$/hora en una familia y región', '"Hasta 72 %"', 'Media: cambias tamaño, no familia'],
            ['SageMaker Savings Plans', 'AWS', 'US$/hora en instancias ml.*', '"Hasta 64 %"', 'Cualquier familia y región dentro de SageMaker AI'],
            ['CUDs por recurso', 'Google Cloud', 'vCPU, memoria, GPUs en una región, 1 o 3 años', '"Hasta 55 %" (70 % memory-optimized)', 'Baja; las GPUs exigen reservas adjuntas'],
            ['CUDs flexibles (por gasto)', 'Google Cloud', 'US$/hora en Compute Engine, GKE y Cloud Run', '16–63 % según recurso y plazo', 'Alta; GPUs solo en series G2 y G4'],
            ['Reservations / savings plan for compute', 'Azure', 'Una VM por región, o US$/hora de cómputo', '"Hasta 72 %" / "hasta 65 %"', 'Como RIs / Compute Savings Plans'],
          ], note: 'Los "hasta" son de 3 años, pagando por adelantado y en las familias más favorables. Descuentos observados a 1 año sin pago adelantado en GPUs de AWS (agregador público, oct. 2026): g4dn.xlarge ' + E('≈ 37 %') + ', g5.xlarge ' + E('≈ 37 %') + ', g6.xlarge ' + E('≈ 35 %') + '; a 3 años, ' + E('≈ 54–57 %') + '.' },
          { t: 'table', caption: 'Descuento vs reserva de capacidad: lo que más se confunde', head: ['', 'Savings Plan / RI regional / CUD', 'Capacity Reservation (AWS) · reserva (GCP)', 'Capacity Blocks for ML (AWS)'], rows: [
            ['¿Baja el precio?', 'Sí', 'No por sí sola; se combina con un Savings Plan o RI regional', 'Precio propio, pagado por adelantado; sin Savings Plans ni RIs'],
            ['¿Garantiza que haya GPUs?', '<b>No</b>', 'Sí, en una zona', 'Sí, en las fechas compradas'],
            ['Plazo', '1 o 3 años', 'Inmediata y sin plazo (o con fecha futura y compromiso)', 'Días a semanas; se reserva hasta 8 semanas antes; no se cancela'],
            ['Para qué', 'La base estable', 'Lo crítico que no puede quedarse sin capacidad', 'Un entrenamiento grande con fecha (p4d, p5, p5e, p5en, p6, trn)'],
          ] },
          { t: 'h3', text: 'Cuándo comprometer y cuánto' },
          { t: 'steps', items: [
            { title: 'Espera datos reales', meta: '2–3 meses', html: '<p>Antes no sabes tu base: el right-sizing, el autoscaling y un cambio de GPU todavía la mueven. c01 compromete "tras 2–3 meses de uso estable" (<a href="#c01.costo">c01</a>).</p>' },
            { title: 'Mide el mínimo, no el promedio', meta: 'uso por hora', html: '<p>Mira el uso por hora de esos meses y toma lo que estuvo encendido <i>siempre</i>: en c01, las 2 T4 de N+1 y los 2 nodos del gateway. Eso es la base.</p>' },
            { title: 'Compromete solo la base', meta: '1 año primero', html: '<p>Un Savings Plan (o CUD) que cubra esa base, a 1 año salvo que la arquitectura esté muy estable. A 3 años el descuento sube, pero apuestas a que no cambiarás de GPU en 3 años.</p>' },
            { title: 'La ráfaga, on-demand o spot', meta: 'nunca comprometida', html: '<p>Lo que agrega el autoscaling en el pico se paga on-demand o en spot. Revisa la cobertura cada trimestre.</p>' },
          ] },
          { t: 'calc', title: 'c01: comprometer la base y no la ráfaga', rows: [
            { label: 'Base de c01: 2 T4 + 2 nodos de gateway', expr: '768 + 248', value: E('≈ US$1,016/mes') },
            { label: 'Ahorro con 30–40 % a 1 año', expr: '1,016 × 0.30 … 1,016 × 0.40', value: E('≈ US$305–406/mes'), note: 'Lo mismo que estima <a href="#c01.costo">c01</a>' },
            { label: 'Error: comprometer 4 T4 (el máximo de KEDA) a ≈ 37 % menos', expr: '4 × 0.331 × 730', value: E('≈ US$967/mes'), note: 'Se paga aunque uses ≈ 2.33 en promedio (la base + la ráfaga de <a href="#m13.spot">spot</a>)' },
            { label: 'Esas ≈ 2.33 T4 promedio, on-demand', expr: '(2 + 2 × 4 ÷ 24) × 0.526 × 730', value: E('≈ US$896/mes'), note: 'El "descuento" salió ≈ US$70 más caro' },
            { label: 'Utilización mínima para que un compromiso convenga', expr: '1 − descuento = 1 − 0.37', value: '> 63 % de lo comprometido' },
          ], result: 'Un compromiso convierte un costo variable en fijo. Sobre la base (100 % de uso) es dinero gratis; sobre la ráfaga es pagar horas que no usas.' },
          { t: 'code', title: 'Tres fórmulas que usas en esta conversación', caption: 'Facturado vs ocupado, spot con trabajo repetido y punto de equilibrio de un compromiso. Corrió tal cual con Python 3.14, sin dependencias.', files: [
            { name: 'costos_nube.py', lang: 'python', code: COSTOS_PY, note: 'Los números son los de esta página; cámbialos por los de tu caso. Ninguna de las tres cuentas necesita la calculadora del proveedor: necesita tu uso por hora.' },
          ] },
          { t: 'callout', kind: 'trap', title: 'Trampa: "con un Savings Plan tengo las GPUs aseguradas"', html: `<p>Un Savings Plan, una RI regional o un CUD de gasto son descuentos de facturación: si la zona se queda sin T4, tu descuento no lanza ninguna instancia. Para asegurar capacidad hace falta una reserva de capacidad (que cobra se use o no) o, para entrenar con fecha, un Capacity Block (<a href="#m06.nodos">M6</a>).</p>` },
          { t: 'callout', kind: 'skip', html: `<p>Sáltate las opciones de pago (all/partial/no upfront), el marketplace de RIs, las RIs convertibles y los detalles de cómo se aplica un Savings Plan hora por hora. En la entrevista: "commit the steady baseline after a few months of real usage, never the burst".</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"After two or three months in production I'd look at hourly usage and commit only what never turned off: the two T4s for N+1 and the gateway nodes, about a thousand dollars a month, so a one-year Savings Plan saves three to four hundred. The autoscaled burst stays on-demand or spot; committing to KEDA's maximum would cost more than paying on-demand."</p>` },
        ],
      },

      // ======================================================== 9
      {
        id: 'cuotas-regiones',
        title: 'Cuotas de GPU, capacidad y regiones',
        titleEn: 'GPU quotas, capacity and regional availability',
        priority: 'extra',
        dims: ['arquitectura', 'tradeoffs', 'monitoreo'],
        blocks: [
          { t: 'p', html: `En la nube, una GPU puede faltar por tres razones distintas, y cada una se resuelve de otra forma: <b>tu cuenta no tiene cuota</b> (un límite administrativo que pides subir), <b>la zona no tiene capacidad</b> de ese tipo en ese momento (<code>InsufficientInstanceCapacity</code>) o <b>la región no ofrece esa GPU</b>. Un autoscaling configurado hasta 20 réplicas no resuelve ninguna (<a href="#m06.nodos">M6</a>).` },
          { t: 'table', caption: 'Cómo cuenta la cuota cada nube', head: ['Nube', 'Unidad', 'Nombres típicos', 'Detalle que muerde'], rows: [
            ['AWS (EC2)', '<b>vCPUs</b>, por región y por grupo de familias', '"Running On-Demand G and VT instances" (L-DB2E81BA), "Running On-Demand P instances" (L-417A185B); spot aparte ("All G and VT Spot Instance Requests")', 'La tabla de valores por defecto de AWS muestra 0 para G y P; AWS también sube cuotas solo según el uso. Una g4dn.2xlarge (1 T4) gasta 8 vCPUs de cuota, el doble que la xlarge'],
            ['AWS (SageMaker AI)', 'Instancias, por tipo y por uso', '"ml.g5.xlarge for endpoint usage", otra para training', 'Separada de la de EC2; muchas arrancan en 0'],
            ['Google Cloud', '<b>GPUs</b>, por modelo y región, más una global', '<code>NVIDIA_L4_GPUS</code>, <code>NVIDIA_T4_GPUS</code>… y <code>GPUS_ALL_REGIONS</code>', 'Si la global está en 0, ninguna regional sirve; spot usa cuota preemptible aparte'],
            ['Azure', '<b>vCPUs</b>, por familia de VM y región, más el total regional', '"Standard NCASv3_T4 Family vCPUs"', 'Las familias con GPU vienen restringidas: hay que pedir la cuota por región'],
          ] },
          { t: 'calc', title: 'Cuánta cuota pedir (AWS, en vCPUs)', rows: [
            { label: 'c01: máximo de KEDA + surge del deploy + staging + CI', expr: '(4 + 1 + 1 + 1) × 4 vCPU (g4dn.xlarge)', value: '28 vCPUs' },
            { label: 'c01 si el NodePool también permite g4dn.2xlarge', expr: '7 × 8 vCPU', value: '56 vCPUs', note: 'Diversificar tamaños (<a href="#m06.nodos">M6</a>) multiplica la cuota que necesitas' },
            { label: 'c04: hasta 4 workers (g6.2xlarge)', expr: '4 × 8 vCPU', value: '32 vCPUs', note: 'Lo que pide <a href="#c04.estimaciones">c04</a>. Con un nodo de surge para el deploy del worker serían 40; con 2 laboratorios más sigue alcanzando (<a href="#c04.seguimiento">c04</a>)' },
          ], result: 'La cuota se pide para el máximo que puedes llegar a usar (autoscaling, surge, entornos auxiliares), por región y antes del lanzamiento: un aumento puede tardar de minutos a días, o no aprobarse.' },
          { t: 'h3', text: 'Asegurar capacidad' },
          { t: 'table', head: ['Herramienta', 'Nube', 'Qué te da', 'Cuándo'], rows: [
            ['On-Demand Capacity Reservation', 'AWS', 'Instancias de un tipo en una zona, cobradas se usen o no (combinable con Savings Plans para el descuento)', 'El mínimo crítico, o antes de un evento conocido'],
            ['Capacity Blocks for ML', 'AWS', 'GPUs grandes (p4d, p5, p5e, p5en, p6, trn) por días o semanas, con fecha, pago por adelantado', 'Un entrenamiento grande con fecha de inicio'],
            ['Reservas (+ CUDs con reserva adjunta)', 'Google Cloud', 'Capacidad zonal; los CUDs de GPU la exigen', 'Base estable de GPUs'],
            ['Dynamic Workload Scheduler', 'Google Cloud', 'Flex-start: tu pedido espera hasta que haya capacidad y corre sin interrupciones durante su duración; Calendar mode: bloques con fecha', 'Entrenamiento y batch que toleran esperar al inicio'],
            ['On-demand capacity reservations', 'Azure', 'Capacidad reservada por región o zona', 'Igual que en AWS'],
          ] },
          { t: 'h3', text: 'Regiones: residencia de datos y GPUs disponibles' },
          { t: 'p', html: `La región la deciden, en este orden: dónde pueden vivir los datos, qué GPUs hay ahí, la latencia a los usuarios y el precio. En <a href="#c04">c04</a> los WSI ya viven "en la región que aprobó legal" y en <a href="#c05">c05</a> hay datos personales bajo la LFPDPPP: la decisión de residencia es de legal (principios generales, no asesoría legal); tu trabajo es saber qué servicios y qué GPUs existen en esa región antes de diseñar. Ejemplo real de por qué importa: a octubre de 2026, la tabla oficial de GPUs por zona de Google Cloud no lista la región de Querétaro (<code>northamerica-south1</code>). Si los datos tuvieran que quedarse ahí, el diseño cambia (otra nube, inferencia en otra región si legal lo permite, o CPU).` },
          { t: 'code', title: 'Preguntarle a la nube antes de diseñar', caption: 'Sintaxis verificada contra la referencia de AWS CLI v2 y la ayuda de gcloud; no se ejecutó contra una cuenta.', files: [
            { name: 'cuotas_y_capacidad.sh', lang: 'bash', code: CUOTAS_SH, note: 'L-DB2E81BA es la cuota de instancias G y VT on-demand en vCPUs. La de spot es otra (L-3819A6DF).' },
          ] },
          { t: 'h3', text: 'Multi-región: lo que cuesta' },
          { t: 'list', items: [
            '<b>Cuota y capacidad por región.</b> Cada región nueva es otra cuota de GPUs que pedir y otra zona donde puede faltar capacidad.',
            '<b>Datos replicados.</b> ' + E('≈ US$0.02/GB') + ' por la transferencia entre regiones más el almacenamiento duplicado; y la consistencia de lo que se escribe en las dos.',
            '<b>Artefactos.</b> Imágenes en ECR y engines en S3 replicados; el engine de TensorRT debe coincidir con la GPU disponible en la otra región.',
            '<b>Operación.</b> Despliegues, monitoreo y on-call por región; el failover se prueba o no existe.',
          ] },
          { t: 'callout', kind: 'senior', html: `<p>c01 no necesita multi-región: 99.9 % con un fallback en la UI se cumple con 2 zonas. Proponer multi-región "por si acaso" duplica cuota, datos y operación para proteger un servicio que ya tiene degradación con gracia. Cuándo sí (requisito regulatorio, usuarios en otro continente, un RTO que una zona no cumple) está en <a href="#m15.multi-region-dr">M15</a>.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"Before launch I'd raise the GPU quota to cover the autoscaler's maximum plus a deploy surge, in each region we use, and I'd allow more than one zone and instance size in the node pool. If losing capacity isn't acceptable, an on-demand capacity reservation covers the minimum; a Savings Plan only gives a discount, not capacity."</p>` },
        ],
      },

      // ======================================================== 10
      {
        id: 'autoevaluacion',
        title: 'Autoevaluación',
        titleEn: 'Self-check',
        priority: 'core',
        dims: ['estimaciones', 'tradeoffs'],
        blocks: [
          { t: 'followups', items: [
            { q: '¿Por qué no lo pones todo en SageMaker y te olvidas?',
              junior: 'Podría ser, SageMaker es más fácil de usar y escala solo.',
              senior: 'Depende de quién opera y del payload. En c01 la empresa ya opera EKS, y con fotos a 10 M/día el endpoint gestionado agrega ≈ 40 % por instancia, US$0.016/GB de data processed y el interface endpoint: ≈ 1.9× la infra (≈ US$3.2k vs ≈ US$1.7k). Y si el backend llamara directo al endpoint con la foto web, su límite de 6 MiB por request obliga a reducirla antes. Sí uso SageMaker AI para el fine-tune mensual: ahí el sobreprecio son decenas de dólares. Sin equipo de plataforma, elegiría el endpoint gestionado y lo revisaría al crecer.',
              why: 'Responde con el criterio (quién opera), el número y un límite concreto, y reconoce dónde la plataforma sí conviene.' },
            { q: 'Necesito bajar la factura un 30 %. ¿Qué haces primero?',
              junior: 'Pasaría todo a spot, que ahorra hasta 90 %.',
              senior: 'Primero recorro la factura: en c01, ≈ 45 % son GPUs y ≈ 30 % el ALB, y el 30 % de ≈ US$1.7k son ≈ US$510. En orden de riesgo: confirmar ruteo por zona y endpoints de S3 y ECR (si faltan, son cientos o miles al mes); un Savings Plan de 1 año sobre la base fija (≈ −US$350); mandar la key de S3 en vez de los bytes (≈ −US$360 netos, si el GET extra cabe en el p99). Con eso llego a ≈ 40 % (<a href="#c01.costo">c01</a>). Si el GET no cabe, alojo en las mismas T4, casi ociosas, los modelos de otros equipos. Spot solo para entrenamiento y backfills; la base online sigue on-demand. Staging no está en esa cuenta: si existe, apagarlo de noche ahorra ≈ US$250 aparte.',
              why: 'Empieza por los datos de la factura, comprueba que las palancas suman el 30 %, ordena por riesgo y no pone el servicio online en spot.' },
            { q: 'La empresa está en Google Cloud, no en AWS. ¿Qué cambia?',
              junior: 'Habría que rediseñar todo para GCP.',
              senior: 'El diseño no: GKE en lugar de EKS, Cloud Storage en lugar de S3, Pub/Sub en lugar de SQS, Cloud Load Balancing en lugar del ALB. Lo que reviso: qué GPUs hay en su región (la L4 viene en máquinas G2; la T4 se agrega a N1), su cuota de GPUs por modelo y la global, y que los nombres cambiaron (Vertex AI ahora es Agent Platform).',
              why: 'Separa la arquitectura de los nombres y va directo a lo que sí cambia: disponibilidad de GPUs y cuotas.' },
            { q: '¿Pondrías el serving de c01 en spot para ahorrar?',
              junior: 'Sí, con Kubernetes los pods se reprograman solos.',
              senior: 'El mínimo no: con 2 minutos de aviso puedo perder una de dos réplicas y quedarme sin N+1, y en una zona sin capacidad spot el reemplazo puede no llegar. Las réplicas de ráfaga sí podrían ir en spot, porque si se van vuelvo a la base y al fallback de la UI, pero ahorran ≈ US$60/mes. El ahorro grande en c01 es comprometer la base.',
              why: 'Distingue base de ráfaga y cuantifica: el ahorro de spot aquí es chico.' },
            { q: 'El autoscaler pide una GPU y el pod queda Pending media hora. ¿Qué pasó?',
              junior: 'Kubernetes tiene un problema; reiniciaría el autoscaler.',
              senior: 'Reviso los tres límites en orden: el NodePool o node group en su máximo; la cuota de vCPUs de instancias G de la región (si la g4dn.2xlarge está permitida, cada nodo gasta 8 vCPUs); y la capacidad de la zona (<code>InsufficientInstanceCapacity</code> en los eventos del autoscaler). La cuota se arregla pidiéndola antes; la capacidad, con más zonas y tamaños o una reserva de capacidad para el mínimo. Y alerto por pods Pending más de unos minutos.',
              why: 'Conoce las tres causas distintas de "no hay GPU" y la solución de cada una.' },
            { q: '¿Cuánto cuesta realmente la nube de c04, si las GPUs trabajan 8 h al día?',
              junior: '8.3 h × 30 × US$0.98 ≈ US$244 al mes.',
              senior: 'Eso es lo trabajado, no lo facturado. Con una lámina cada ≈ 42 s y 15 min de cooldown, el primer worker no se apaga en todo el horario de escáneres: ≈ 15 h/día facturadas, ≈ US$441/mes. Y lo que de verdad cambia la factura de red es por dónde bajan los WSI: 36 TB/mes por el NAT serían ≈ US$1,620; por el gateway endpoint de S3, cero.',
              why: 'Distingue horas facturadas de horas ocupadas y encuentra el costo oculto que supera a la GPU.' },
          ] },
          { t: 'quiz', items: [
            { q: 'c04 baja 36 TB/mes de WSI desde S3 a nodos en subredes privadas. ¿Qué cambio de red ahorra más?',
              options: ['Pasar los workers a spot', 'Un VPC endpoint de tipo gateway para S3 en vez de salir por el NAT', 'Comprimir los logs', 'Un Savings Plan de 3 años'],
              answer: 1,
              explain: 'Por el NAT: 36 TB × US$0.045 ≈ US$1,620/mes, ≈ 3.7× las GPUs. El gateway endpoint de S3 no cobra por GB.' },
            { q: 'Compraste un Savings Plan que cubre 2 T4 y la zona se queda sin capacidad de g4dn. ¿Qué te garantiza el plan?',
              options: ['Que AWS te reserve las 2 instancias', 'Prioridad sobre los clientes sin plan', 'Nada de capacidad: es un descuento de facturación; para capacidad hace falta una reserva', 'Que el autoscaler use otra región'],
              answer: 2,
              explain: 'Savings Plans y RIs regionales no reservan capacidad. Una On-Demand Capacity Reservation sí, y se combina con el plan para el descuento.' },
            { q: 'En AWS, ¿qué instancia te da la T4 más barata por GPU-hora?',
              options: ['g4dn.xlarge (1 T4)', 'g4dn.12xlarge (4 T4)', 'g4dn.metal (8 T4)', 'Da igual, el precio es por GPU'],
              answer: 0,
              explain: 'g4dn.xlarge ≈ US$0.53 por GPU-hora; g4dn.12xlarge ≈ US$3.91 ÷ 4 ≈ US$0.98. Las grandes cobran CPU, RAM y red de entrenamiento.' },
            { q: 'c01 manda ≈ 46 TB/mes de tensores UINT8 a un endpoint de SageMaker AI de tiempo real. ¿Qué línea agrega más, aparte de las instancias?',
              options: ['El registro de modelos', 'Data processed (US$0.016/GB) y el interface endpoint (US$0.01/GB)', 'El control plane de EKS', 'Nada: el precio incluye todo'],
              answer: 1,
              explain: '≈ US$737 + ≈ US$475 al mes. El sobreprecio de la instancia (≈ 40 %) es ≈ US$307: los cobros por GB pesan más.' },
            { q: '¿Cuál de estas cargas NO conviene poner en spot?',
              options: ['El fine-tune mensual con checkpoints', 'Los workers de c04 que leen de una cola SQS', 'Las 2 réplicas mínimas de Triton en c01', 'Un backfill de predicciones por shards'],
              answer: 2,
              explain: 'El mínimo online es el N+1: con 2 min de aviso (30 s en GCP o Azure) quedarías con una réplica y sin margen.' },
            { q: 'Un Savings Plan de 1 año da ≈ 37 % de descuento. ¿Desde qué utilización de lo comprometido conviene?',
              options: ['Más de 37 %', 'Más de 63 %', 'Siempre conviene', 'Más de 90 %'],
              answer: 1,
              explain: 'Pagas el 63 % de la tarifa por todas las horas comprometidas: conviene si usas más del 63 % de ellas. Por eso se compromete la base, no el máximo del autoscaler.' },
            { q: 'Tu cuenta de AWS es nueva y el primer nodo g4dn.xlarge no arranca por cuota. ¿En qué unidad la pides?',
              options: ['Número de GPUs', 'vCPUs de "Running On-Demand G and VT instances" en esa región', 'Número de instancias en la cuenta, global', 'Dólares por mes'],
              answer: 1,
              explain: 'AWS cuenta vCPUs por región y grupo de familias: una g4dn.xlarge gasta 4, una g4dn.2xlarge 8. En GCP sí es por GPU (por modelo y región, más una global).' },
            { q: 'Un equipo propone mandar los logs de debug de c06 (≈ 1 KB por ítem, 180 M ítems/día) a CloudWatch Logs. ¿Orden de magnitud?',
              options: ['≈ US$30/mes', '≈ US$270/mes', '≈ US$2.7k/mes', '≈ US$27k/mes'],
              answer: 2,
              explain: '≈ 5,472 GB/mes × US$0.50 de ingesta ≈ US$2.7k. Guardarlos en S3 cuesta ≈ US$126 el primer mes.' },
          ] },
          { t: 'checklist', id: 'costos-antes-de-proponer', items: [
            { id: 'nube-equipo', html: 'Pregunté en qué nube está la empresa y quién opera la plataforma antes de nombrar servicios.' },
            { id: 'servicio-porque-costo', html: 'Cada servicio que nombré va con su porqué y un costo mensual con su supuesto.' },
            { id: 'instancia-chica', html: 'Elegí la instancia más chica con la GPU que necesito y di su precio por hora y por mes.' },
            { id: 'payload', html: 'Calculé los bytes por request y por mes: ALB, cruce de AZ y data processed salen de ahí.' },
            { id: 'zona', html: 'Cada salto queda en su zona (ruteo por zona) y nombré el costo si no.' },
            { id: 'endpoints', html: 'Pesos, imágenes y datos vienen de S3 y ECR por VPC endpoints, no por el NAT.' },
            { id: 'logs', html: 'Los logs de predicción van a S3; CloudWatch solo para logs del servicio, sin payloads.' },
            { id: 'ocioso', html: 'Separé horas facturadas de horas trabajando (cooldowns, mínimos, staging).' },
            { id: 'spot', html: 'Spot solo para lo interrumpible (entrenamiento con checkpoints, batch idempotente), con el descuento real verificado.' },
            { id: 'compromiso', html: 'Comprometo solo la base estable, tras 2–3 meses de uso real; nunca el máximo del autoscaler.' },
            { id: 'cuota', html: 'Pedí cuota de GPUs para el máximo + surge + entornos auxiliares, por región, antes del lanzamiento.' },
            { id: 'region', html: 'Verifiqué que la región elegida (por residencia de datos) tenga las GPUs y servicios del diseño.' },
          ] },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'm13-01', kind: 'frase', q: 'El patrón para responder cualquier pregunta de nube.',
        a: 'Servicio + porqué + orden de magnitud del costo. "Triton on EKS with two g4dn.xlarge, one per zone, because we already run EKS: about US$770 a month in GPUs."' },
      { id: 'm13-02', kind: 'concepto', q: 'EKS, colas, object storage y endpoints de ML en GCP y Azure.',
        a: 'Kubernetes: EKS · GKE · AKS. Cola: SQS · Pub/Sub · Service Bus. Object storage: S3 · Cloud Storage · Blob Storage. ML: SageMaker AI · Gemini Enterprise Agent Platform (ex Vertex AI) · Azure Machine Learning.' },
      { id: 'm13-03', kind: 'concepto', q: 'Tres renombres recientes que te pueden corregir.',
        a: 'Vertex AI = Gemini Enterprise Agent Platform; SageMaker = SageMaker AI; Azure AI Foundry = Microsoft Foundry. Mismas piezas y mismas APIs: basta con reconocer los dos nombres, no las fechas.' },
      { id: 'm13-04', kind: 'trampa', q: '"Pub/Sub es el SQS de Google."',
        a: 'Solo como categoría. Pub/Sub hace de cola y de stream, pero no es Kafka: no controlas particiones y el replay es por tiempo o snapshot. Cloud Run escala por requests hasta cero; Fargate es un runtime de tareas sin autoscaling propio.' },
      { id: 'm13-05', kind: 'numero', q: 'Sobreprecio de un endpoint de SageMaker AI frente a EC2.',
        a: '≈ 40 % por instancia en GPU (ml.g4dn.xlarge ≈ US$0.736/h vs US$0.526), ≈ 20 % en CPU, más US$0.016/GB de data processed de entrada y de salida. Azure ML no cobra sobre la VM.' },
      { id: 'm13-06', kind: 'numero', q: 'Límites de InvokeEndpoint (SageMaker AI, tiempo real).',
        a: 'Cuerpo de hasta 6,291,456 B (6 MiB) y 60 s de respuesta del contenedor. Para inputs grandes: Asynchronous Inference (hasta 1 GB por S3, hasta 1 h).' },
      { id: 'm13-07', kind: 'tradeoff', q: 'c01: Triton en EKS vs endpoint de SageMaker AI.',
        a: 'Tier GPU ≈ US$768 vs ≈ US$2,287 (instancias + data processed + interface endpoint) → infra ≈ US$1.7k vs ≈ US$3.2k. Gana EKS porque ya hay plataforma y el payload es grande; sin equipo de plataforma, el gestionado.' },
      { id: 'm13-08', kind: 'tradeoff', q: 'c05: Textract vs OCR propio.',
        a: 'Textract ≈ US$279/mes (186k páginas a US$1.50 por 1,000) vs ≈ US$248 de OCR propio en CPU (empata) o ≈ US$768 en 2 T4. La factura no decide: sumando ¼ de persona, el equilibrio está en ≈ 3.1–3.9 M páginas/mes. Gana Textract por operación y calidad.' },
      { id: 'm13-09', kind: 'concepto', q: 'Por qué la instancia más chica con tu GPU gana en inferencia.',
        a: 'Por GPU-hora es igual o más barata (g4dn.xlarge ≈ US$0.53 vs g4dn.12xlarge ≈ US$0.98), da granularidad de N+1 y de autoscaling y achica el dominio de falla. Las grandes cobran CPU, RAM y red de entrenamiento.' },
      { id: 'm13-10', kind: 'numero', q: 'Precio por hora de las GPUs de AWS (us-east-1).',
        a: 'T4 ≈ US$0.53 (g4dn.xlarge), L4 ≈ US$0.80 (g6.xlarge), A10G ≈ US$1.01, A100 ≈ US$2.75 por GPU (p4d, en grupos de 8), H100 ≈ US$6.88 por GPU (p5).' },
      { id: 'm13-11', kind: 'concepto', q: 'Aviso de interrupción de spot en AWS, GCP y Azure.',
        a: 'AWS: 2 min (EventBridge y metadata), más rebalance recommendation. GCP: señal en metadata y un apagado de hasta 30 s. Azure: evento Preempt con al menos 30 s de aviso. Todos "best effort"; en GCP y Azure no alcanza para un checkpoint.' },
      { id: 'm13-12', kind: 'trampa', q: '"Spot ahorra 90 %."',
        a: 'Es el techo publicitario. En oct-2026, una foto en us-east-1 daba ≈ 48 % en g4dn.xlarge, ≈ 25 % en g6.xlarge y ≈ 1 % en g6e.xlarge. Y hay que restar el trabajo repetido. Verifica con el historial de precios.' },
      { id: 'm13-13', kind: 'concepto', q: 'Qué va en spot y qué no.',
        a: 'Sí: entrenamiento con checkpoints, batch idempotente (c04), backfills, CI. No: el mínimo de un servicio online (c01). Con cuidado: réplicas de ráfaga, si la base cumple el SLO sola.' },
      { id: 'm13-14', kind: 'numero', q: 'Fine-tune de 40 h en g5.xlarge: on-demand vs spot.',
        a: '≈ US$40 on-demand; en spot a US$0.462 con 4 interrupciones y checkpoint cada 30 min (≈ 25 min perdidos cada una): 41.7 h × 0.462 ≈ US$19, ≈ 52 % menos.' },
      { id: 'm13-15', kind: 'trampa', q: 'Nodos en subred privada bajando pesos y datos de S3.',
        a: 'Por el NAT pagan US$0.045/GB: c04 con 36 TB/mes de WSI serían ≈ US$1,620, ≈ 3.7× sus GPUs. Un gateway endpoint de S3 no cobra por GB. ECR: interface endpoints ecr.api y ecr.dkr (solo manifiestos) más ese mismo gateway de S3, porque las capas bajan de S3; sin él, el pull falla.' },
      { id: 'm13-16', kind: 'numero', q: 'Cómo cobra el ALB y cuánto le cuesta a c01.',
        a: 'US$0.0225/h + US$0.008 por LCU-h; con fotos en el body manda la dimensión de bytes (1 GB/h por LCU). ≈ 61 TB/mes ≈ 83 LCUs → ≈ US$503/mes, ≈ 30 % de la infra.' },
      { id: 'm13-17', kind: 'numero', q: 'Cruce de AZ: tarifa y el ejemplo de c01.',
        a: 'US$0.01/GB al salir y US$0.01 al entrar. c01 sin ruteo por zona: ≈ 90 TB/mes × US$0.02 ≈ US$1,800, más que las dos GPUs. Antídoto: trafficDistribution: PreferSameZone.' },
      { id: 'm13-18', kind: 'numero', q: 'Logs: CloudWatch vs S3.',
        a: 'CloudWatch Logs: US$0.50/GB al ingerir + US$0.03/GB-mes. S3: US$0.023/GB-mes. c06 con ≈ 5.5 TB/mes de logs: ≈ US$2.7k en CloudWatch vs ≈ US$126 en S3.' },
      { id: 'm13-19', kind: 'trampa', q: 'Guardar cada tile de c04 como un objeto en S3.',
        a: '3.6 M PUT/día × 30.4 × US$0.005 por 1,000 ≈ US$547/mes solo en PUTs. Con millones de objetos chicos, pagas requests; se agrupan en archivos grandes (c04 guarda GeoJSON + PNG por lámina).' },
      { id: 'm13-20', kind: 'concepto', q: 'Horas facturadas vs horas trabajando en c04.',
        a: 'Trabaja ≈ 8.3 h/día (≈ US$244/mes) pero factura ≈ 15 h/día (≈ US$441): una lámina cada ≈ 42 s y 15 min de cooldown mantienen el nodo arriba todo el horario. ≈ 45 % es espera.' },
      { id: 'm13-21', kind: 'tradeoff', q: 'Savings Plan vs Capacity Reservation vs Capacity Block.',
        a: 'Savings Plan: descuento por US$/h comprometidos, sin capacidad. Capacity Reservation: capacidad en una zona, cobrada se use o no, sin descuento propio. Capacity Block: GPUs grandes con fecha, días a semanas, pago adelantado.' },
      { id: 'm13-22', kind: 'numero', q: 'Cuándo conviene un compromiso de ≈ 37 %.',
        a: 'Si usas más del 63 % de lo comprometido. Comprometer la base de c01 (≈ US$1,016/mes) ahorra ≈ US$305–406; comprometer 4 T4 usando ≈ 2.33 en promedio cuesta ≈ US$967 vs ≈ US$896 on-demand.' },
      { id: 'm13-23', kind: 'concepto', q: 'Cómo cuenta cada nube la cuota de GPUs.',
        a: 'AWS: vCPUs por región y grupo de familias ("Running On-Demand G and VT instances"); SageMaker AI aparte, por tipo de instancia. GCP: GPUs por modelo y región + una global (GPUS_ALL_REGIONS). Azure: vCPUs por familia y región.' },
      { id: 'm13-24', kind: 'numero', q: 'Cuota que pide c01 en AWS.',
        a: '(4 de KEDA + 1 surge + 1 staging + 1 CI) × 4 vCPU = 28 vCPUs de instancias G; 56 si el NodePool permite g4dn.2xlarge (8 vCPU con la misma T4).' },
      { id: 'm13-25', kind: 'concepto', q: 'Qué decide la región, en orden.',
        a: 'Residencia de datos (la decide legal), GPUs y servicios disponibles ahí, latencia a usuarios y precio. A oct-2026, la tabla oficial de GPUs de Google Cloud no lista Querétaro (northamerica-south1).' },
      { id: 'm13-26', kind: 'frase', q: '¿Cómo resumes en inglés tu postura de costos de nube?',
        a: '"Smallest instance with the GPU we need, on-demand for the online minimum, spot for training and batch, a Savings Plan only on the steady baseline after a few months, and I follow the bytes: load balancer, cross-zone traffic, NAT and logs often cost as much as the GPUs."' },
    ],

    // ---------------------------------------------------------- glosario
    // Ya definidos en otros archivos (no se repiten): egress, NAT gateway, cross-AZ data
    // transfer, Load Balancer Capacity Unit (LCU), Savings Plans, spot instance,
    // on-demand instance, managed endpoint, serverless inference, insufficient capacity
    // error (ICE), capex vs opex, availability zone (AZ), scale to zero, Amazon Textract,
    // AWS Step Functions. Seguridad, privacidad y residencia de datos: M15.
    glossary: [
      { en: 'reserved instance (RI)', es: 'instancia reservada', def: 'Compromiso de 1 o 3 años con un tipo de instancia en una región (o zona) a cambio de descuento. La RI regional solo descuenta; la zonal además reserva capacidad.', say: 'Once usage has been flat for a few months, I\'d cover the gateway nodes with a one-year commitment; zonal reserved instances only if we also need the capacity guarantee.' },
      { en: 'committed use discount (CUD)', es: 'descuento por uso comprometido', def: 'El compromiso de Google Cloud: por recursos (vCPU, memoria, GPUs en una región; las GPUs exigen una reserva adjunta) o flexible por gasto. 1 o 3 años.', say: 'On GCP the GPU baseline would be a resource-based CUD with an attached reservation.' },
      { en: 'Capacity Reservation', es: 'reserva de capacidad', def: 'En AWS, capacidad de un tipo de instancia en una zona, cobrada se use o no. No da descuento por sí sola; se combina con Savings Plans o RIs regionales.', say: 'A Savings Plan is a discount; the capacity reservation is what guarantees our two T4s.' },
      { en: 'Capacity Blocks for ML', es: 'bloques de capacidad para ML', def: 'Reserva en AWS de GPUs grandes (p4d, p5, p6, trn…) por días o semanas, con fecha de inicio hasta 8 semanas adelante y pago por adelantado; no se cancela.', say: 'For the two-week training run we buy a Capacity Block instead of hoping for on-demand H100s.' },
      { en: 'Dynamic Workload Scheduler (DWS)', es: 'planificador dinámico de cargas', def: 'Servicio de Google Cloud para conseguir GPUs: flex-start espera hasta que haya capacidad y corre sin interrupción durante el tiempo pedido; calendar mode reserva bloques con fecha.', say: 'The fine-tune can wait an hour to start, so flex-start is cheaper than holding a reservation.' },
      { en: 'service quota', es: 'cuota de servicio', def: 'Límite administrativo por cuenta y región. En AWS las GPUs se cuentan en vCPUs por grupo de familias; en GCP, en GPUs por modelo y región más una global. Se pide subir antes de necesitarla.', say: 'Our G-instance quota covers the autoscaler maximum plus a deploy surge.' },
      { en: 'spot interruption notice', es: 'aviso de interrupción spot', def: 'Señal de que la nube recuperará una instancia spot: 2 minutos en AWS; en GCP, un apagado de hasta 30 s; en Azure, un aviso de al menos 30 s; siempre "best effort". El job debe guardar estado o devolver su trabajo a la cola.', say: 'On the interruption notice the worker stops pulling messages and the current slide goes back to the queue.' },
      { en: 'Spot VM', es: 'VM spot', def: 'Nombre de las instancias interrumpibles en Google Cloud y Azure. En GCP son la versión nueva de las preemptible VMs (que duran como máximo 24 h); las Spot VMs no tienen duración máxima fija.', say: 'Training runs on Spot VMs with checkpoints every thirty minutes.' },
      { en: 'price-capacity-optimized', es: 'optimizada por precio y capacidad', def: 'Estrategia de asignación de spot en AWS (EC2 Fleet, Auto Scaling) que elige los pools con menos riesgo de interrupción y, entre ellos, los más baratos.', say: 'We spread spot across several instance types with the price-capacity-optimized strategy.' },
      { en: 'VPC endpoint', es: 'endpoint de VPC', def: 'Acceso privado de una VPC a un servicio de AWS sin pasar por internet ni por el NAT. Gateway (S3 y DynamoDB): sin cargo. Interface (PrivateLink): ≈ US$0.01/h por zona + US$0.01/GB.', say: 'Model weights come from S3 through a gateway endpoint, so they never touch the NAT.' },
      { en: 'data processing charge', es: 'cargo por datos procesados', def: 'Cobro por GB que pasa por un servicio gestionado, aparte de las horas: NAT gateway, interface endpoints o los endpoints de SageMaker AI (US$0.016/GB de entrada y de salida).', say: 'With images, the endpoint\'s data processing charge costs more than its instance premium.' },
      { en: 'vendor lock-in', es: 'dependencia del proveedor', def: 'El costo de salir de un proveedor: APIs propias, formatos, procesos de despliegue y egress para mover los datos. Se acota con piezas estándar (contenedores, Kubernetes, MLflow) donde importa.', say: 'The model runs in a standard Triton container, so lock-in is limited to the deployment layer.' },
      { en: 'cost allocation tag', es: 'etiqueta de asignación de costos', def: 'Etiqueta en cada recurso (modelo, equipo, entorno) que la factura usa para agrupar costos. Convierte líneas sueltas en "este modelo cuesta X al mes".', say: 'Every GPU node carries a model tag, so we can report cost per thousand predictions per model.' },
      { en: 'SageMaker AI', es: 'SageMaker AI', def: 'Plataforma de ML de AWS (renombrada desde "Amazon SageMaker" el 3-dic-2024): training jobs, endpoints real-time, asíncronos, serverless y batch, pipelines, registry, feature store y monitoreo. Las APIs siguen diciendo sagemaker.', say: 'We use SageMaker AI for training jobs and serve on our own EKS cluster.' },
      { en: 'Gemini Enterprise Agent Platform', es: 'Agent Platform (antes Vertex AI)', def: 'Nombre desde abril de 2026 de la plataforma de IA de Google Cloud que absorbió Vertex AI: training, online inference endpoints, pipelines, registry y feature store, más herramientas de agentes.', say: 'On Google Cloud we\'d use Agent Platform endpoints, what used to be Vertex AI.' },
      { en: 'Azure Machine Learning', es: 'Azure Machine Learning', def: 'La plataforma de MLOps de Azure para modelos propios: jobs de entrenamiento, managed online endpoints, batch endpoints, pipelines y registries. No cobra encima de la VM. Los modelos fundacionales viven en Microsoft Foundry.', say: 'Azure Machine Learning bills the VMs at list price, so the managed endpoint has no premium.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
