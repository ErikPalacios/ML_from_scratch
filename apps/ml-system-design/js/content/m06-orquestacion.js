/* =============================================================================
   Ronda de Diseño ML — js/content/m06-orquestacion.js
   Módulo 06: orquestación y escalado. Qué resuelve Kubernetes y cuándo no hace
   falta, los objetos que sí se preguntan (requests/limits, QoS, probes, rolling
   updates), GPUs en Kubernetes, HPA y por qué la CPU no sirve para escalar un
   servicio de GPU, KEDA y escalar a cero, nodos GPU (Cluster Autoscaler y
   Karpenter), cold starts, serverless con GPU y alta disponibilidad.
   Contrato: docs/SPEC.md §5. Los números y valores del caso 1 son los de
   c01-clasificacion.js y reference/c01/k8s: si cambian allá, se cambian aquí.
   Verificado (sept. 2026) contra la documentación de Kubernetes (1.37 publicada el
   26-08-2026), KEDA 2.21, Karpenter 1.14, Cluster Autoscaler, NVIDIA (device plugin,
   GPU Operator, DCGM exporter), AWS (Lambda, SageMaker, AMIs de EKS) y Google Cloud Run.
   Los YAML de este archivo pasaron kubernetes-validate --strict (1.34 y 1.36) o el
   esquema de su CRD (KEDA 2.21.0, Karpenter 1.14.1).
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // Marca de estimación (SPEC §5.3): subrayado punteado + "est."
  const est = (s) => '<span class="est">' + s + '</span>';

  // ------------------------------------------------------------ diagramas
  // Los dos lazos de autoscaling. Fila de pods (y 7–15) de izquierda a derecha,
  // fila de nodos (y 26–34) de derecha a izquierda; columnas x = 2, 24, 46, 68, 90 (w 16,
  // huecos de 6 con etiquetas cortas). El atajo del nodo de reserva pasa por debajo (y 38.5);
  // la vuelta al tráfico sube por x = 14 para no pisar la etiqueta del carril de nodos.
  const LAZOS = {
    width: 108, height: 42,
    lanes: [
      { id: 'pods', label: 'Pods · segundos', x: 0, y: 0, w: 108, h: 18, kind: 'monitor' },
      { id: 'nodos', label: 'Nodos · minutos', x: 0, y: 20, w: 108, h: 22, kind: 'neutral' },
    ],
    nodes: [
      { id: 'triton', label: 'Pods de Triton', sub: 'métricas en :8002', x: 2, y: 7, w: 16, h: 8, kind: 'gpu',
        note: 'Cada pod de Triton publica sus métricas (tiempo en cola, requests en espera, inferencias) en el puerto 8002. Son la materia prima del escalado: si Prometheus no las scrapea, nada escala.' },
      { id: 'prom', label: 'Prometheus', sub: 'scrape cada 15 s (c01)', x: 24, y: 7, w: 16, h: 8, kind: 'monitor',
        note: 'Guarda las series y responde la query de KEDA. En c01 la query promedia la espera en cola sobre una ventana de 2 min: suaviza el ruido y a la vez retrasa la reacción. Ese retraso es el primer tramo del cold start (sección 7).' },
      { id: 'keda', label: 'KEDA', sub: 'expone la métrica', x: 46, y: 7, w: 16, h: 8, kind: 'service',
        note: 'Consulta el trigger (aquí, Prometheus) y expone el resultado como métrica externa para el HPA que él mismo creó (<code>keda-hpa-triton</code>). También decide el paso de 0 a 1 y de 1 a 0 cuando el mínimo es cero.' },
      { id: 'hpa', label: 'HPA', sub: 'ceil(n × valor / umbral)', x: 68, y: 7, w: 16, h: 8, kind: 'service',
        note: 'Cada 15 s calcula réplicas = ceil(actuales × métrica / objetivo) y aplica las políticas de <code>behavior</code>. En c01: sube de a 1 pod por minuto y baja de a 1 cada 5 min, con una ventana de 10 min.' },
      { id: 'deploy', label: 'Deployment', sub: 'replicas 2 → 3', x: 90, y: 7, w: 16, h: 8, kind: 'service',
        note: 'Recibe el nuevo número de réplicas y crea el pod. Hasta aquí van segundos. Lo que sigue depende de si existe un nodo con una GPU libre.' },
      { id: 'pending', label: 'Pod Pending', sub: 'ninguna GPU libre', x: 90, y: 26, w: 16, h: 8, kind: 'job',
        note: 'Cada g4dn.xlarge tiene una sola T4 y ya está ocupada: el scheduler no encuentra dónde poner el pod y lo marca como no agendable ("Insufficient nvidia.com/gpu"). Esa condición es la señal que mira el autoscaler de nodos.' },
      { id: 'karp', label: 'Karpenter', sub: 'o Cluster Autoscaler', x: 68, y: 26, w: 16, h: 8, kind: 'service',
        note: 'Ve el pod pendiente, calcula qué instancia lo satisface (T4, zona permitida, toleration del taint) y la pide. Cluster Autoscaler haría lo mismo agrandando un node group. Si la zona no tiene capacidad, prueba otra combinación.' },
      { id: 'ec2', label: 'API de EC2', sub: 'g4dn.xlarge en una AZ', x: 46, y: 26, w: 16, h: 8, kind: 'external',
        note: 'Aquí puede fallar lo que no controlas: falta de capacidad del tipo en esa zona (InsufficientInstanceCapacity) o la cuota de vCPUs de instancias G de tu cuenta.' },
      { id: 'nodo', label: 'Nodo GPU nuevo', sub: 'join + device plugin', x: 24, y: 26, w: 16, h: 8, kind: 'gpu',
        note: 'La instancia bootea, el kubelet se une al cluster, el driver ya está en la AMI y el device plugin anuncia <code>nvidia.com/gpu: 1</code>. Recién entonces el scheduler puede poner el pod. ' + est('≈ 2–5 min') + ' desde el Pending, según c01.' },
      { id: 'listo', label: 'Pod listo', sub: 'imagen, engine, readiness', x: 2, y: 26, w: 16, h: 8, kind: 'gpu',
        note: 'Descarga la imagen (' + est('≈ 2–5 min') + ' para los ≈ 9 GB del c01), Triton carga el engine y hace el warmup, y la readiness pasa. Solo entonces el Service le manda tráfico.' },
    ],
    edges: [
      { from: 'triton', to: 'prom', kind: 'monitor', label: 'scrape' },
      { from: 'prom', to: 'keda', kind: 'monitor', label: 'PromQL' },
      { from: 'keda', to: 'hpa', kind: 'monitor', label: 'métrica' },
      { from: 'hpa', to: 'deploy', kind: 'neutral', label: 'réplicas' },
      { from: 'deploy', to: 'pending', kind: 'neutral', label: 'crea pod', fromSide: 'b', toSide: 't' },
      { from: 'pending', to: 'karp', kind: 'neutral', label: 'no cabe' },
      { from: 'karp', to: 'ec2', kind: 'neutral', label: 'lanza' },
      { from: 'ec2', to: 'nodo', kind: 'neutral', label: 'bootea' },
      { from: 'nodo', to: 'listo', kind: 'neutral', label: 'agenda' },
      { from: 'listo', to: 'triton', kind: 'online', fromSide: 't', toSide: 'b', via: [[14, 20.5]] },
      { from: 'pending', to: 'listo', kind: 'neutral', dashed: true, label: 'desaloja al placeholder', via: [[98, 38.5], [10, 38.5]] },
    ],
    flows: [
      { id: 'sin-nodo', label: 'Escalar sin GPU libre', steps: [
        { nodes: ['triton', 'prom'], edges: ['triton>prom'], text: 'Llega más tráfico y la espera en la cola de Triton pasa de ≈ 2 a 25 ms. Prometheus la ve en su siguiente scrape.' },
        { nodes: ['prom', 'keda', 'hpa'], edges: ['prom>keda', 'keda>hpa'], text: 'KEDA consulta la query y el HPA calcula ceil(2 × 25 / 10) = 5 réplicas; el máximo es 4 y la política deja subir de a una por minuto: pide 3.' },
        { nodes: ['hpa', 'deploy', 'pending'], edges: ['hpa>deploy', 'deploy>pending'], text: 'El Deployment crea el tercer pod. Las dos T4 existentes están ocupadas: el pod queda Pending. Hasta aquí, segundos.' },
        { nodes: ['pending', 'karp', 'ec2'], edges: ['pending>karp', 'karp>ec2'], text: 'Karpenter ve el pod pendiente y pide una instancia con T4 en una zona permitida. Si EC2 no tiene capacidad ahí, prueba otra combinación.' },
        { nodes: ['ec2', 'nodo', 'listo'], edges: ['ec2>nodo', 'nodo>listo'], text: 'El nodo bootea, se une al cluster y el device plugin anuncia la GPU; el pod se agenda, descarga la imagen y carga el engine. Minutos.' },
        { nodes: ['listo', 'triton'], edges: ['listo>triton'], text: 'La readiness pasa, el Service agrega el endpoint y baja la cola de su zona; la otra zona necesita su propia réplica (el 4.º pod, sección 9). Entre el primer síntoma y este paso pasaron ' + est('≈ 5–13 min') + '.' },
      ] },
      { id: 'reserva', label: 'Con un nodo de reserva', steps: [
        { nodes: ['deploy', 'pending'], edges: ['deploy>pending'], text: 'Mismo arranque: el HPA pide un pod y no hay GPU libre… salvo la que ocupa un pod placeholder de prioridad −10.' },
        { nodes: ['pending', 'listo'], edges: ['pending>listo'], text: 'El scheduler desaloja al placeholder (preemption) y pone el pod real en ese nodo, que ya existe: te ahorras los 2–5 min del nodo y, si la imagen de Triton viene precargada en la AMI, también el pull.' },
        { nodes: ['karp', 'ec2', 'nodo'], edges: ['karp>ec2', 'ec2>nodo'], text: 'El placeholder desalojado queda Pending y dispara, en segundo plano, un nodo nuevo que será la próxima reserva. El precio: un nodo GPU pagado siempre.' },
      ] },
      { id: 'bajar', label: 'Bajar cuando pasa el pico', steps: [
        { nodes: ['hpa', 'deploy'], edges: ['hpa>deploy'], text: 'La cola vuelve a ≈ 2 ms. En c01 el HPA espera 10 min (ventana de estabilización) y baja de a un pod cada 5 min, nunca por debajo de 2.' },
        { nodes: ['karp'], edges: [], text: 'El nodo que quedó vacío lo retira el autoscaler de nodos (consolidación en Karpenter, scale-down en Cluster Autoscaler), respetando el PodDisruptionBudget.' },
      ] },
    ],
  };

  // Alta disponibilidad de c01 en dos zonas. Entrada arriba (y 4–11); dos carriles de zona
  // lado a lado (y 15–37); Karpenter abajo (y 41–48). Los gateways quedan al centro para que
  // el ALB baje recto; el camino entre zonas pasa por debajo de los nodos (y 33.5).
  const ZONAS = {
    width: 108, height: 50,
    lanes: [
      { id: 'entrada', label: 'Entrada', x: 0, y: 0, w: 108, h: 13, kind: 'neutral' },
      { id: 'za', label: 'Zona us-east-1a', x: 0, y: 15, w: 52, h: 22, kind: 'online' },
      { id: 'zb', label: 'Zona us-east-1b', x: 56, y: 15, w: 52, h: 22, kind: 'online' },
      { id: 'nodos', label: 'Nodos', x: 0, y: 39, w: 108, h: 11, kind: 'neutral' },
    ],
    nodes: [
      { id: 'caller', label: 'Callers', sub: 'backend, otros equipos', x: 4, y: 4, w: 18, h: 7, kind: 'client',
        note: 'El backend del marketplace y otros equipos. Si no reciben respuesta en 300 ms, la UI muestra el selector manual: por eso el servicio puede degradar sin ser un incidente mayor.' },
      { id: 'alb', label: 'ALB', sub: 'health check /readyz', x: 44, y: 4, w: 20, h: 7, kind: 'edge',
        note: 'Un balanceador con nodos en las dos zonas. Manda tráfico solo a los gateways que pasan el health check; si una zona entera falla, deja de enviarle en cuanto los checks fallan.' },
      { id: 'tra', label: 'Triton 1a', sub: 'una T4 · PDB min 1', x: 4, y: 22, w: 18, h: 8, kind: 'gpu',
        note: 'Una de las dos réplicas mínimas. El topology spread la obliga a estar en una zona distinta de la otra. Sola aguanta el pico de diseño al ≈ 42 % de su máximo medido.' },
      { id: 'gwa', label: 'Gateways 1a', sub: 'HPA por CPU', x: 30, y: 22, w: 18, h: 8, kind: 'service',
        note: 'Pods del gateway repartidos entre zonas (ScheduleAnyway: mejor un reparto imperfecto que pods Pending). Con <code>trafficDistribution: PreferSameZone</code> llaman al Triton de su propia zona.' },
      { id: 'gwb', label: 'Gateways 1b', sub: 'HPA por CPU', x: 60, y: 22, w: 18, h: 8, kind: 'service',
        note: 'Si cae la zona 1a, estos pods reciben todo el tráfico: necesitan ≈ 3 cores en el pico de diseño y el HPA duplica sus réplicas en minutos. Mientras tanto, el load shedding (503 rápido) protege la latencia.' },
      { id: 'trb', label: 'Triton 1b', sub: 'una T4 · PDB min 1', x: 86, y: 22, w: 18, h: 8, kind: 'gpu',
        note: 'La otra réplica. Si el Triton de 1a desaparece, los gateways de 1a cruzan de zona hasta aquí: cuesta transferencia entre AZs mientras dure, pero no se cae el servicio.' },
      { id: 'karp', label: 'Karpenter', sub: 'repone nodos', x: 44, y: 41, w: 20, h: 7, kind: 'service',
        note: 'Repone el nodo que murió en su zona. Durante la caída de una zona entera agrega nodos de CPU para los gateways de la zona sana; un segundo Triton ahí lo impide la regla de spread de c01 (ver el texto de la sección).' },
    ],
    edges: [
      { from: 'caller', to: 'alb', kind: 'online', label: 'HTTPS' },
      { from: 'alb', to: 'gwa', kind: 'online', fromSide: 'b', toSide: 't', via: [[48, 13.5], [39, 13.5]] },
      { from: 'alb', to: 'gwb', kind: 'online', fromSide: 'b', toSide: 't', via: [[60, 13.5], [72, 13.5]] },
      { from: 'gwa', to: 'tra', kind: 'online', label: 'local' },
      { from: 'gwb', to: 'trb', kind: 'online', label: 'local' },
      { from: 'gwa', to: 'trb', kind: 'neutral', dashed: true, label: 'si 1a no tiene Triton', via: [[42, 33.5], [95, 33.5]] },
      { from: 'karp', to: 'tra', kind: 'neutral', label: 'nodo en 1a', fromSide: 'l', toSide: 'b', via: [[13, 44.5]] },
      { from: 'karp', to: 'trb', kind: 'neutral', label: 'nodo en 1b', fromSide: 'r', toSide: 'b', via: [[99, 44.5]] },
    ],
    flows: [
      { id: 'normal', label: 'Normal', steps: [
        { nodes: ['caller', 'alb'], edges: ['caller>alb'], text: 'Los callers llegan al ALB, que tiene presencia en las dos zonas.' },
        { nodes: ['alb', 'gwa', 'gwb'], edges: ['alb>gwa', 'alb>gwb'], text: 'El ALB reparte entre los gateways sanos de ambas zonas.' },
        { nodes: ['gwa', 'tra', 'gwb', 'trb'], edges: ['gwa>tra', 'gwb>trb'], text: 'Cada gateway llama al Triton de su zona: los tensores de 602 KB no cruzan de AZ y cada T4 trabaja al ≈ 21 % de su máximo en el pico de diseño.' },
      ] },
      { id: 'cae-triton', label: 'Cae el Triton de 1a', steps: [
        { nodes: ['tra'], edges: [], text: 'Muere la instancia de la T4 en 1a. Nadie corre probes en un nodo muerto: a los ≈ 50 s sin reportes (<code>node-monitor-grace-period</code>) el nodo pasa a NotReady y su pod a no listo, y recién ahí sale de los endpoints. Mientras tanto, los gateways de 1a le siguen mandando requests que vencen a los 150 ms.' },
        { nodes: ['gwa', 'trb'], edges: ['gwa>trb'], text: 'Sin endpoint listo en su zona, PreferSameZone manda a los gateways de 1a al Triton de 1b. Degrada (transferencia entre zonas, unos ms más), no se cae.' },
        { nodes: ['trb'], edges: [], text: 'La T4 de 1b carga los 500 req/s del pico de diseño al ≈ 42 % de su máximo medido. El PDB no intervino: la muerte de un nodo es una disrupción involuntaria.' },
        { nodes: ['karp', 'tra'], edges: ['karp>tra'], text: 'A los 5 min (<code>tolerationSeconds: 300</code>, el default para el taint unreachable) el pod se desaloja; el Deployment crea otro, queda Pending y Karpenter lanza otra g4dn en 1a. El N+1 vuelve tras esos 5 min más el cold start de nodo de la sección 7.' },
      ] },
      { id: 'cae-zona', label: 'Cae la zona 1a entera', steps: [
        { nodes: ['alb', 'gwb'], edges: ['alb>gwb'], text: 'Los health checks de los targets de 1a fallan y el ALB manda todo a 1b.' },
        { nodes: ['gwb', 'trb'], edges: ['gwb>trb'], text: 'Los gateways de 1b pasan a necesitar ≈ 3 cores: el HPA duplica pods en minutos y el load shedding cubre el hueco. Triton 1b queda al ≈ 42 %.' },
        { nodes: ['karp', 'trb'], edges: ['karp>trb'], text: 'Karpenter agrega nodos en 1b para los gateways. Un segundo Triton en 1b no aparece: la regla de spread de c01 cuenta la zona muerta como dominio con 0 pods. Se acepta porque una T4 aguanta; mientras dure, no hay N+1.' },
      ] },
    ],
  };

  // ------------------------------------------------------------ código
  const TRITON_PROBES = `# Fragmento de reference/c01/k8s/triton.yaml: el contenedor de Triton
containers:
  - name: triton
    image: 123456789012.dkr.ecr.us-east-1.amazonaws.com/classifier-triton:2026-09-01-resnet50-fp16
    ports:
      - name: http
        containerPort: 8000
    resources:
      requests:
        cpu: "2"            # red, deserializar y el scheduler de batching
        memory: 6Gi         # librerías CUDA y buffers; el modelo vive en la GPU
        nvidia.com/gpu: 1   # una T4 entera por pod
      limits:
        memory: 6Gi         # límite = request: si se pasa, OOMKilled claro
        nvidia.com/gpu: 1   # GPUs: request = limit, sin sobreasignar
        # Sin límite de CPU a propósito: el throttling de CFS mete latencia
    # Carga del engine + warmup: hasta 60 × 5 s = 5 min. Mientras no pase,
    # el kubelet no evalúa liveness (no mata a un pod que solo está cargando)
    startupProbe:
      httpGet:
        path: /v2/health/ready
        port: http
      periodSeconds: 5
      failureThreshold: 60
    # ¿Le mando tráfico? Solo con el modelo cargado (--strict-readiness)
    readinessProbe:
      httpGet:
        path: /v2/health/ready
        port: http
      periodSeconds: 5
      timeoutSeconds: 2
      failureThreshold: 2
    # ¿Está colgado el proceso? "live", nunca "ready": un modelo que no carga no se arregla
    # reiniciando en bucle
    livenessProbe:
      httpGet:
        path: /v2/health/live
        port: http
      periodSeconds: 10
      timeoutSeconds: 2
      failureThreshold: 3`;

  const GPU_DEPLOY = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: detector
  namespace: vision
spec:
  replicas: 2
  selector:
    matchLabels:
      app: detector
  template:
    metadata:
      labels:
        app: detector
    spec:
      # 1) Adónde puede ir: solo al node group de T4 (el engine se compiló para sm_75)
      nodeSelector:
        workload: gpu-t4
      # 2) Permiso para entrar: los nodos GPU tienen el taint nvidia.com/gpu=present:NoSchedule
      tolerations:
        - key: nvidia.com/gpu
          operator: Equal
          value: present
          effect: NoSchedule
      containers:
        - name: server
          image: 123456789012.dkr.ecr.us-east-1.amazonaws.com/detector:2026-09-01
          resources:
            # CPU y memoria con request: sin ellos, el pod sería BestEffort aunque pida GPU
            requests:
              cpu: "2"
              memory: 6Gi
            limits:
              memory: 6Gi
              # 3) Qué consume: una GPU entera. Solo enteros; en limits (el request se copia solo)
              nvidia.com/gpu: 1`;

  const HPA_CUSTOM = `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: triton
  namespace: classifier
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: triton
  minReplicas: 2   # N+1: una GPU por zona aunque una sola cubra el pico
  maxReplicas: 4   # techo de costo y de nodos GPU
  metrics:
    # Métrica por pod que Prometheus Adapter publica en custom.metrics.k8s.io, hecha con
    # nv_inference_pending_request_count de Triton (requests esperando a la GPU)
    - type: Pods
      pods:
        metric:
          name: triton_pending_requests
        target:
          type: AverageValue
          averageValue: "4"   # promedio por pod; normal ≈ 0–1 (Little: 250 req/s × pocos ms)
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0   # subir ya: un nodo GPU tarda minutos en llegar
      policies:
        - type: Pods
          value: 1                    # de a una GPU por minuto
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 600  # bajar despacio: la cola "salta"
      policies:
        - type: Pods
          value: 1
          periodSeconds: 300`;

  const KEDA_SQS = `# Credenciales: el rol IAM (IRSA) del operador de KEDA, sin llaves en el YAML
apiVersion: keda.sh/v1alpha1
kind: TriggerAuthentication
metadata:
  name: aws-pod-identity
  namespace: ocr
spec:
  podIdentity:
    provider: aws
---
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: ocr-workers
  namespace: ocr
spec:
  scaleTargetRef:
    name: ocr-workers  # Deployment de workers GPU que leen la cola
  minReplicaCount: 0  # de noche, cero GPUs (el default de KEDA ya es 0: escríbelo igual)
  maxReplicaCount: 8  # techo de costo: 8 × g4dn.xlarge
  pollingInterval: 15  # cada 15 s pregunta a SQS (el default es 30)
  cooldownPeriod: 600  # 10 min sin mensajes antes de bajar de 1 a 0
  triggers:
    - type: aws-sqs-queue
      authenticationRef:
        name: aws-pod-identity
      metadata:
        queueURL: https://sqs.us-east-1.amazonaws.com/123456789012/ocr-jobs
        awsRegion: us-east-1
        # Mensajes por worker (AverageValue): 300 s de espera aceptable / ≈ 20 s por job = 15
        queueLength: "15"
        # Visibles + en proceso (el default): no baja de 1 a 0 mientras quede un mensaje
        # en proceso. De N a M sí puede cortar jobs: ver la trampa de abajo
        scaleOnInFlight: "true"`;

  const NODEPOOL = `apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: gpu-t4
spec:
  template:
    metadata:
      labels:
        workload: gpu-t4  # la misma label que pide el nodeSelector de Triton
    spec:
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: gpu  # AMI con driver NVIDIA; ahí puedes precargar la imagen de Triton
      requirements:
        # Cualquier tamaño con UNA T4 sirve (el engine es para sm_75):
        # si falta g4dn.xlarge en una zona, puede lanzar una g4dn.2xlarge
        - key: karpenter.k8s.aws/instance-gpu-name
          operator: In
          values: ["t4"]
        - key: karpenter.k8s.aws/instance-gpu-count
          operator: In
          values: ["1"]
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["on-demand"]  # serving online: nada de spot
        # Las 2 zonas de c01. Con una 3.ª, el spread podría mandar un Triton a una zona
        # sin gateways (no le llegaría tráfico) y cambia el análisis de la sección 9
        - key: topology.kubernetes.io/zone
          operator: In
          values: ["us-east-1a", "us-east-1b"]
      taints:
        - key: nvidia.com/gpu
          value: present
          effect: NoSchedule
  limits:
    nvidia.com/gpu: 6  # techo duro del pool: KEDA pide hasta 4 + surge del deploy + reserva
  disruption:
    consolidationPolicy: WhenEmpty  # nunca mueve un Triton vivo para ahorrar; solo quita nodos vacíos
    consolidateAfter: 10m`;

  const RESERVA = `apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: reserva-gpu
# -10: la prioridad más baja que todavía hace escalar al Cluster Autoscaler
# (por debajo de su corte por defecto, -10, los pods no piden nodos nuevos)
value: -10
globalDefault: false
description: "Placeholders que reservan un nodo GPU caliente; cualquier pod real los desaloja"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: reserva-gpu
  namespace: classifier
spec:
  replicas: 1
  selector:
    matchLabels:
      app: reserva-gpu
  template:
    metadata:
      labels:
        app: reserva-gpu
    spec:
      priorityClassName: reserva-gpu
      # Sin esperas al desalojarlo: el pod real necesita la GPU ya
      terminationGracePeriodSeconds: 0
      nodeSelector:
        workload: gpu-t4
      tolerations:
        - key: nvidia.com/gpu
          operator: Equal
          value: present
          effect: NoSchedule
      containers:
        - name: pausa
          # No hace nada: solo ocupa lugar. Pide la GPU completa para que el nodo exista
          image: registry.k8s.io/pause:3.10
          resources:
            requests:
              cpu: 100m
              memory: 64Mi
            limits:
              memory: 64Mi
              nvidia.com/gpu: 1`;

  const KEDA_CRON = `# El ScaledObject de c01 (k8s/keda-triton.yaml) con un segundo trigger: cron.
# Todo lo demás queda igual; los comentarios de ese archivo explican cada campo
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: triton
  namespace: classifier
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: triton
  minReplicaCount: 2
  maxReplicaCount: 4
  pollingInterval: 15
  cooldownPeriod: 300
  advanced:
    horizontalPodAutoscalerConfig:
      behavior:
        scaleUp:
          stabilizationWindowSeconds: 0
          policies:
            - type: Pods
              value: 1
              periodSeconds: 60
        scaleDown:
          stabilizationWindowSeconds: 600
          policies:
            - type: Pods
              value: 1
              periodSeconds: 300
  triggers:
    - type: prometheus
      metricType: Value
      metadata:
        serverAddress: http://prometheus-operated.monitoring.svc.cluster.local:9090
        ignoreNullValues: "false"  # query vacía = error visible, no un 0 silencioso
        query: |
          sum(rate(nv_inference_queue_duration_us{model="classifier"}[2m]))
            /
          clamp_min(sum(rate(nv_inference_request_success{model="classifier"}[2m])), 1e-9)
            / 1000
        threshold: "10"
    # Escalado programado: 3 réplicas de 18:30 a 23:00 (hora de CDMX), antes del pico de las 20:00.
    # El HPA toma el MÁXIMO entre triggers: fuera de la ventana manda la cola, dentro nunca baja de 3.
    - type: cron
      metadata:
        timezone: America/Mexico_City
        start: 30 18 * * *
        end: 0 23 * * *
        desiredReplicas: "3"`;

  const HA = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: triton
  namespace: classifier
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: triton
  template:
    metadata:
      labels:
        app.kubernetes.io/name: triton
    spec:
      # preStop (10 s) + --exit-timeout-secs de Triton (30 s) + margen
      terminationGracePeriodSeconds: 60
      topologySpreadConstraints:
        # Con 2 réplicas, una por zona. DoNotSchedule: mejor un pod Pending (y una alerta)
        # que dos GPUs en la misma AZ
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: triton
      containers:
        - name: triton
          image: 123456789012.dkr.ecr.us-east-1.amazonaws.com/classifier-triton:2026-09-01-resnet50-fp16
          lifecycle:
            preStop:
              exec:
                # El Service tarda unos segundos en sacar el pod de los endpoints:
                # seguir sirviendo 10 s antes del SIGTERM
                command: ["sleep", "10"]
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: triton
  namespace: classifier
spec:
  # Solo evicciones VOLUNTARIAS (drain, upgrades, consolidación): siempre queda 1 Triton.
  # No protege de la muerte de un nodo ni de una zona: eso es N+1
  minAvailable: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: triton`;

  // ------------------------------------------------------------ registro
  MSD.register({
    id: 'm06',
    kind: 'module',
    sections: [
      // ======================================================== 1
      {
        id: 'por-que-k8s',
        title: 'Qué resuelve Kubernetes (y cuándo no lo necesitas)',
        titleEn: 'What Kubernetes solves, and when you don\'t need it',
        priority: 'core',
        dims: ['arquitectura', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Empieza por lo que corre en producción en el <a href="#c01">caso 1</a>: 2 pods de Triton, cada uno con su T4, en 2 zonas; entre 3 y 12 pods de gateway; Prometheus, KEDA y un balanceador. Sin un orquestador, alguien tendría que decidir en qué máquina va cada proceso, reiniciarlo cuando muere, reemplazar la máquina que se cae, actualizar la versión sin cortar tráfico, decirle al gateway dónde está Triton y agregar réplicas a las 8 p. m. Kubernetes automatiza esas cinco cosas con un mismo mecanismo: tú declaras el estado deseado en YAML ("2 réplicas de esta imagen, con una GPU cada una") y unos controladores comparan todo el tiempo lo deseado con lo real y corrigen la diferencia.` },
          { t: 'table', caption: 'Lo que te da un orquestador', head: ['Capacidad', 'Qué hace', 'En c01'], rows: [
            ['Scheduling', 'Elige un nodo con CPU, memoria y GPU libres que cumpla tus reglas (labels, taints, zonas)', 'Triton solo en nodos con T4, una réplica por zona'],
            ['Self-healing', 'Reinicia el contenedor que muere o falla la liveness; recrea el pod en otro nodo si el suyo desaparece', 'Un Triton colgado se reinicia; si muere su nodo, el pod se recrea y el autoscaler de nodos trae otra máquina'],
            ['Rollouts', 'Cambia de versión de a poco (rolling update) y permite volver (<code>kubectl rollout undo</code>, o un <code>git revert</code> si el cluster se maneja con GitOps)', 'Versión nueva del modelo = tag nuevo de la imagen de Triton'],
            ['Service discovery y balanceo', 'Un nombre DNS estable delante de los pods sanos', '<code>triton.classifier.svc.cluster.local:8000</code> en <code>TRITON_URL</code>'],
            ['Autoscaling', 'Réplicas (HPA, KEDA) y nodos (Cluster Autoscaler, Karpenter)', 'Gateway por CPU; Triton por tiempo en cola'],
          ] },
          { t: 'callout', kind: 'why', title: 'Por qué en ML pesa más que en una API común', html: `<p>Tres cosas que una API web típica no tiene: GPUs caras y escasas que hay que reservar solo para quien las usa (<a href="#m06.gpus-k8s">sección 3</a>), procesos que tardan minutos en arrancar porque cargan gigabytes de pesos (probes y cold starts, <a href="#m06.cold-starts">sección 7</a>) y una carga que no se mide en CPU (autoscaling con métricas custom, <a href="#m06.hpa">sección 4</a>). Casi todo lo que te preguntan de Kubernetes en una entrevista de MLE sale de esas tres.</p>` },
          { t: 'h3', text: 'Las alternativas, de menos a más control' },
          { t: 'table', caption: 'Dónde correr el serving', head: ['Opción', 'Cuándo encaja', 'GPU', 'Carga operativa', 'Lo que pierdes'], rows: [
            ['Una o dos VMs con Docker Compose', 'Un modelo, tráfico chico o interno, equipo de 1–2 personas, MVP', 'La que tenga la VM', 'Baja al inicio; los parches, reinicios y deploys los haces tú', 'Autoscaling, deploys sin corte y reemplazo automático de máquinas. c01 usa Compose solo en local (<a href="#c01.archivos">archivos</a>)'],
            ['Contenedores gestionados (ECS, Cloud Run, Azure Container Apps)', 'Pocos servicios, sin plataforma de Kubernetes, equipo chico', 'ECS con instancias GPU; Cloud Run y Container Apps con GPU serverless (<a href="#m06.serverless">sección 8</a>)', 'Media o baja', 'Control fino (scheduling, métricas custom, sidecars); más atado al proveedor'],
            ['Endpoints gestionados de modelos (SageMaker, Vertex AI, Azure ML)', 'Equipo de ML sin plataforma, pocos modelos; quieres autoscaling, canary y métricas sin operar nodos', 'Sí: eliges el tipo de instancia', 'Baja', 'Pagas un sobreprecio por instancia frente a la VM equivalente (verifícalo en la página de precios), menos control del runtime y de la red, y los límites del producto'],
            ['Kubernetes con una capa de serving (KServe, Ray Serve)', 'Ya hay cluster y no quieres escribir tú el autoscaling por requests en vuelo, el canary (KServe) o la composición de modelos en Python (Ray Serve)', 'Sí, sobre los node pools con GPU', 'Media-alta: el cluster más el operador', 'Otra capa que actualizar; menos control fino que tus propios Deployments'],
            ['Kubernetes gestionado (EKS, GKE, AKS)', 'La empresa ya lo opera; muchos servicios y modelos; necesitas control (GPUs compartidas, métricas custom, portabilidad)', 'Sí: node pools con GPU y device plugin', 'Alta: node groups, drivers, autoscaling de dos niveles, upgrades del cluster', 'Nada funcional; lo pagas en complejidad, en gente y en el control plane (EKS: ' + est('≈ US$73/mes') + ')'],
          ] },
          { t: 'callout', kind: 'senior', html: `<p>La pregunta que decide no es técnica: <b>¿quién va a operar esto?</b> c01 eligió EKS asumiendo que la empresa ya tiene un equipo de plataforma (<a href="#c01.tradeoffs">trade-offs de c01</a>). Si el enunciado dice "somos 3 personas y no hay Kubernetes", la respuesta pragmática es un endpoint gestionado, y lo dices así: "empezaría en SageMaker real-time y lo revisaría cuando tengamos varios modelos o el sobreprecio pese en la factura". Montar un cluster para un solo modelo es la respuesta que el entrevistador anota como sobreingeniería.</p>` },
          { t: 'callout', kind: 'skip', html: `<p>etcd, el algoritmo de puntaje del scheduler, kube-proxy en iptables vs IPVS, los plugins de red (CNI) y cómo se elige líder en el control plane: casi nunca aparecen en una ronda de ML System Design. Si te preguntan, di que usas el control plane gestionado del proveedor y vuelve al diseño.</p>` },
          { t: 'h3', text: 'Qué se pregunta en la entrevista y qué no' },
          { t: 'p', html: `En una ronda de ML System Design, Kubernetes aparece cuando el entrevistador tira del hilo del escalado o de la disponibilidad. Casi todo lo que anota cabe en tres preguntas: con qué señal escalas, cuánto tarda y qué pasa si cae una zona.` },
          { t: 'table', head: ['Tema', '¿Lo preguntan?', 'Qué esperan oír'], rows: [
            ['Por qué no escalas la GPU por CPU y qué señal usas', 'Sí, casi siempre', 'La señal del recurso que se satura primero: tiempo en cola o requests en espera en el model server (<a href="#m06.hpa">sección 4</a>)'],
            ['Cuánto tarda en escalar y cómo aguantas un spike', 'Sí', 'Minutos entre nodo, imagen y modelo; headroom y load shedding para los spikes, escalado programado para los picos conocidos (<a href="#m06.cold-starts">sección 7</a>)'],
            ['N+1 por zona y qué pasa si cae una', 'Sí', 'Una réplica por zona, cuánta carga queda en la que sobrevive y qué no cubre el PDB (<a href="#m06.alta-disponibilidad">sección 9</a>)'],
            ['Kubernetes vs endpoint gestionado vs VM', 'A veces', 'Lo decide quién lo va a operar (esta sección)'],
            ['Escalar a cero y serverless con GPU', 'A veces', 'El SLO del primer request y cuántas horas al día trabaja la GPU (<a href="#m06.keda">sección 5</a> y <a href="#m06.serverless">sección 8</a>)'],
            ['Device plugin, taints, requests/limits, QoS y probes', 'Como follow-up', 'Qué resuelve cada uno y qué se rompe si falta (<a href="#m06.objetos-basicos">sección 2</a> y <a href="#m06.gpus-k8s">sección 3</a>)'],
            ['Defaults y flags del HPA, qué trae cada AMI, la lista de triggers de KEDA, internals de Cluster Autoscaler y Karpenter', 'No', 'Nada: son consulta (las tablas de este módulo y la <a href="#ref-comandos">hoja de comandos</a>)'],
          ] },
          { t: 'callout', kind: 'skip', html: `<p>Si tienes poco tiempo: secciones 1, 4, 7 y 9, y la autoevaluación. El resto sirve para los follow-ups y para operar el <a href="#c01.archivos">c01</a>.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"We already run EKS, so the gateway and Triton go there: Kubernetes gives us scheduling onto the GPU nodes, self-healing, rolling updates and autoscaling. If the team had no platform, I'd start with a managed endpoint like SageMaker and revisit once we have several models."</p>` },
          { t: 'callout', kind: 'connect', html: `<p>Kubernetes mueve imágenes: cómo se construyen y por qué pesan varios GB está en <a href="#m05">M5</a>. Gestionado vs autogestionado en cada nube, en <a href="#m13">M13</a>. Los manifests reales del caso 1, comentados línea por línea, en <a href="#c01.archivos">sus archivos de referencia</a>.</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'objetos-basicos',
        title: 'Los objetos que sí debes conocer',
        titleEn: 'The Kubernetes objects you actually need',
        priority: 'core',
        dims: ['arquitectura', 'monitoreo'],
        blocks: [
          { t: 'p', html: `Con ocho objetos describes todo el caso 1. No necesitas saber escribirlos de memoria; sí qué problema resuelve cada uno y qué pasa cuando está mal configurado.` },
          { t: 'table', head: ['Objeto', 'Qué es', 'Uso en ML', 'En c01'], rows: [
            ['Pod', 'La unidad que se agenda: uno o más contenedores que comparten red y volúmenes, en un solo nodo', 'Un proceso de serving o de gateway. Es efímero: no guardes estado ahí', 'Un pod de Triton = una T4'],
            ['Deployment', 'Mantiene N réplicas idénticas de un pod y gestiona los rollouts', 'Serving online sin estado: gateways y model servers', '<code>gateway</code> y <code>triton</code>, sin <code>replicas</code> en el YAML porque las decide el autoscaler'],
            ['Service', 'Nombre DNS e IP estables delante de los pods que cumplen un selector; balancea por conexión (L4)', 'Que el gateway llame a Triton por nombre y no por IP de pod', '<code>triton:8000</code> con ruteo por zona'],
            ['Ingress / Gateway API', 'Entrada HTTP(S) desde fuera del cluster (L7): hosts, paths, TLS', 'Exponer la API del modelo', 'Un Ingress que el AWS Load Balancer Controller convierte en un ALB interno'],
            ['ConfigMap / Secret', 'Configuración y credenciales montadas como variables de entorno o archivos', 'Nombre y versión del modelo, timeouts, URLs. Para S3 o el registry, mejor la identidad de la nube (IRSA) que un Secret con llaves', 'Config como env en el Deployment (<code>TRITON_URL</code>, <code>INFER_TIMEOUT_S</code>)'],
            ['Job / CronJob', 'Pods que corren hasta terminar, con reintentos / en horario', 'Batch inference, backfills, evaluación nocturna, reentrenamiento', 'El backfill offline de c01 corre como job, no en el camino online'],
            ['HorizontalPodAutoscaler', 'Ajusta las réplicas de un Deployment según métricas', 'CPU para tiers de CPU; métricas custom para GPU (<a href="#m06.hpa">sección 4</a>)', 'Gateway: CPU al 60 %; el de Triton lo crea KEDA'],
            ['PodDisruptionBudget', 'Mínimo de pods que deben quedar durante evicciones voluntarias', 'Que un drain o un upgrade del cluster no te deje sin GPUs sirviendo', 'Triton: <code>minAvailable: 1</code>'],
          ], note: 'Ingress sigue funcionando, pero su API está congelada y el controlador ingress-nginx de la comunidad se retiró en marzo de 2026 (sin más parches). Para diseños nuevos, Gateway API o el controlador de tu nube.' },
          { t: 'callout', kind: 'skip', html: `<p>StatefulSet, Operators y CRDs: rara vez en esta ronda. De DaemonSet basta con saber que existe y para qué: un pod por nodo. Así corren el device plugin de NVIDIA, el exportador de métricas de GPU y los agentes de logs.</p>` },
          { t: 'h3', text: 'Requests y limits: lo que más se pregunta' },
          { t: 'p', html: `En c01, cada pod de gateway pide 1 CPU y 1 GiB; cada Triton pide 2 CPU, 6 GiB y una GPU. El <b>request</b> es lo que reservas: el scheduler solo pone el pod donde quede libre y el HPA mide la utilización como porcentaje de él. El <b>limit</b> es el techo. Se comportan distinto según el recurso:` },
          { t: 'table', head: ['Recurso', 'Request', 'Limit', 'Qué pasa al pasarte del limit'], rows: [
            ['CPU', 'Reserva para agendar; base del % del HPA; peso al repartir CPU entre contenedores', 'Cuota por ventana de 100 ms (CFS del kernel)', '<b>Throttling</b>: el contenedor se congela el resto de la ventana. No muere; se vuelve lento, a ráfagas'],
            ['Memoria', 'Reserva para agendar; decide a quién desaloja el kubelet si el nodo se queda sin memoria', 'Tope duro', '<b>OOMKilled</b> (exit code 137): el kernel mata el proceso y el kubelet reinicia el contenedor'],
            ['<code>nvidia.com/gpu</code>', 'Va en limits; si lo pones también en requests, tiene que ser igual', 'Igual al request', 'No existe "pasarse": la GPU es del pod entera o no es suya'],
          ] },
          { t: 'callout', kind: 'trap', title: 'Un límite de CPU en el gateway', html: `<p>Pod con <code>limits.cpu: 1</code>: 100 ms de CPU por cada ventana de 100 ms. Llegan 4 fotos a la vez y 4 hilos las decodifican en paralelo, cada una con 40 ms de CPU. Los 4 hilos gastan 4 ms de CPU por cada ms de reloj: a los 25 ms se agotó la cuota y el contenedor queda congelado hasta que empieza la siguiente ventana, en el ms 100. Ahí terminan en 15 ms. Cada foto tardó 115 ms en vez de 40, con un uso promedio de CPU que en la gráfica se ve bajo.</p><p>Por eso c01 no pone límite de CPU ni en el gateway ni en Triton: el request ya garantiza su parte. Se detecta con <code>container_cpu_cfs_throttled_periods_total</code> dividido entre <code>container_cpu_cfs_periods_total</code>. La memoria sí se limita, igual al request: pasarse es un OOMKilled claro, no una lentitud misteriosa.</p>` },
          { t: 'h3', text: 'Clases de QoS' },
          { t: 'p', html: `Kubernetes clasifica cada pod según sus requests y limits de CPU y memoria. Cuando el nodo se queda sin memoria, la clase pesa en el orden de desalojo (junto con la prioridad del pod y cuánto se pasa de su request).` },
          { t: 'table', head: ['Clase', 'Regla', 'Si el nodo se queda sin memoria', 'Ejemplo'], rows: [
            ['Guaranteed', 'Cada contenedor con request = limit de CPU y de memoria', 'Los últimos en salir', 'Un pod con CPUs enteras fijas; con la política <code>static</code> del CPU manager puede tener cores exclusivos'],
            ['Burstable', 'Al menos un request o limit de CPU o memoria, sin llegar a Guaranteed', 'Después de todos los BestEffort', 'Los dos tiers de c01: CPU con request y sin límite, memoria con límite = request'],
            ['BestEffort', 'Ningún request ni limit de CPU o memoria', 'Los primeros', 'Un pod que solo pide <code>nvidia.com/gpu: 1</code>'],
          ] },
          { t: 'callout', kind: 'trap', title: 'El pod de GPU que es BestEffort', html: `<p>Los recursos extendidos no cuentan para la QoS: un pod que solo declara <code>nvidia.com/gpu: 1</code> es BestEffort. El scheduler no le reserva CPU ni memoria, puede caer en un nodo donde otros ya se llevaron la CPU, es el primero en salir si falta memoria y un HPA por CPU no puede calcular su utilización (no hay request contra el cual medir). Declara siempre CPU y memoria, como hace c01.</p>` },
          { t: 'h3', text: 'Probes para un servidor de modelos' },
          { t: 'p', html: `Un model server tarda en arrancar: carga gigabytes de pesos, construye su estado en la GPU y hace warmup. Las tres probes responden preguntas distintas, y mezclarlas es de las fallas más comunes en producción:` },
          { t: 'table', head: ['Probe', 'Pregunta', 'Si falla', 'En un model server'], rows: [
            ['startupProbe', '¿Ya terminó de arrancar?', 'Tras <code>failureThreshold × periodSeconds</code>, reinicia el contenedor. Mientras no pase, las otras dos no corren', 'Cubre la carga de pesos y el warmup: en Triton de c01, 60 × 5 s = 5 min'],
            ['readinessProbe', '¿Le mando tráfico?', 'El pod sale de los endpoints del Service; no se reinicia', 'Pasa solo con el modelo cargado y caliente: <code>/v2/health/ready</code> (con <code>--strict-readiness</code>) en Triton, <code>/readyz</code> en el gateway'],
            ['livenessProbe', '¿Está colgado el proceso?', 'Reinicia el contenedor', 'Solo el proceso: <code>/v2/health/live</code>, <code>/healthz</code>. Nunca una dependencia'],
          ], note: 'Defaults si no los pones: <code>periodSeconds</code> 10, <code>timeoutSeconds</code> 1, <code>failureThreshold</code> 3, <code>initialDelaySeconds</code> 0. Un endpoint de health que corre una inferencia de prueba puede pasar de 1 s bajo carga: la liveness falla justo en el pico y el kubelet reinicia pods sanos. Los health checks deben ser baratos.' },
          { t: 'code', title: 'Recursos y probes de Triton', caption: 'Fragmento del Deployment de c01 (validado dentro del manifest completo). El archivo entero, con cada línea comentada, está en <a href="#c01.archivos">los archivos de c01</a>.', files: [
            { name: 'triton.yaml (fragmento)', lang: 'yaml', code: TRITON_PROBES },
          ] },
          { t: 'callout', kind: 'trap', title: 'La dependencia en la liveness', html: `<p>Si la liveness del gateway preguntara por Triton, una caída de Triton haría que el kubelet reinicie, en cascada, gateways sanos que no arreglan nada y que tardan en volver cuando Triton regresa. Por eso c01 separa <code>/healthz</code> (el proceso responde) de <code>/readyz</code> (el modelo está listo en Triton). La dependencia va en la readiness, o en las respuestas (503 con <code>Retry-After</code>).</p>` },
          { t: 'h3', text: 'Rolling updates cuando las GPUs son escasas' },
          { t: 'p', html: `Un rolling update reemplaza pods de a poco, según dos números: <code>maxSurge</code> (cuántos pods de más puede haber) y <code>maxUnavailable</code> (cuántos de menos). Ambos valen 25 % por defecto; el surge se redondea hacia arriba y el unavailable hacia abajo. Con 2 réplicas: surge = ceil(0.5) = 1 y unavailable = floor(0.5) = 0, es decir, un pod extra durante el deploy. Con 8 réplicas: 2 de más y 2 de menos.` },
          { t: 'p', html: `En un tier de GPU, "un pod extra" es una GPU extra. Si no hay una libre, el pod nuevo queda Pending hasta que el autoscaler de nodos traiga otra máquina (minutos, <a href="#m06.cold-starts">sección 7</a>), o para siempre si el node group está en su máximo o la cuenta no tiene cuota. A los 600 s (<code>progressDeadlineSeconds</code> por defecto) el Deployment marca <code>ProgressDeadlineExceeded</code>, pero no revierte solo: los pods viejos siguen sirviendo y el deploy queda a medias.` },
          { t: 'table', head: ['Estrategia', 'GPUs extra durante el deploy', 'Riesgo', 'Cuándo'], rows: [
            ['<code>maxSurge: 1</code>, <code>maxUnavailable: 0</code> (c01)', '+1 durante minutos', 'Si no llega un nodo, el deploy espera', 'Default razonable si el autoscaler de nodos puede agregar uno'],
            ['<code>maxSurge: 0</code>, <code>maxUnavailable: 1</code>', 'Ninguna', 'Una réplica menos durante el deploy: con el mínimo de N+1, pierdes la redundancia mientras dura', 'Sin GPUs extra (cuota, capacidad) y fuera del pico'],
            ['Nodo de reserva (<a href="#m06.nodos">sección 6</a>)', 'Usa la reserva', 'Pagas el nodo todo el tiempo', 'Deploys frecuentes y cold start de nodo largo'],
          ], note: 'Canary, blue/green y shadow, con sus réplicas propias, están en <a href="#m11">M11</a>.' },
          { t: 'callout', kind: 'interview', html: `<p>"Triton has a startup probe with a five-minute budget for loading the engine and warming up. Readiness only passes once the model is loaded, and liveness checks the process alone, never a dependency. I don't set CPU limits on serving pods, because CFS throttling shows up as tail latency."</p>` },
          { t: 'callout', kind: 'connect', html: `<p>Los comandos para ver cada cosa (<code>kubectl describe</code>, eventos, OOMKilled, probes que fallan) están en <a href="#ref-comandos.depurar">la hoja de Docker y kubectl</a>. El CPU throttling como causa de tail latency ya apareció en <a href="#m03.percentiles">M3</a>.</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'gpus-k8s',
        title: 'GPUs en Kubernetes',
        titleEn: 'GPUs in Kubernetes',
        priority: 'core',
        dims: ['arquitectura'],
        blocks: [
          { t: 'p', html: `Kubernetes no sabe qué es una GPU. Lo aprende de un <b>device plugin</b>: un DaemonSet del fabricante que corre en cada nodo con GPU, las detecta y se las anuncia al kubelet como un <b>recurso extendido</b>. Una g4dn.xlarge aparece con <code>nvidia.com/gpu: 1</code> en su capacidad, y desde ahí el scheduler la cuenta como cuenta CPU y memoria.` },
          { t: 'steps', items: [
            { title: 'Driver de NVIDIA en el nodo', meta: 'host', html: `<p>El driver vive en la máquina, no en tu imagen; el toolkit de CUDA que usa tu código viaja en la imagen, y el driver tiene que ser compatible con él (<a href="#m05.cuda">M5</a>). Lo trae la AMI o lo instala el GPU Operator.</p>` },
            { title: 'NVIDIA Container Toolkit', meta: 'runtime', html: `<p>Configura el runtime de contenedores (containerd) para montar la GPU y las librerías del driver dentro del contenedor (<a href="#m05.gpu-en-contenedor">M5</a>).</p>` },
            { title: 'Device plugin', meta: 'DaemonSet', html: `<p>Anuncia <code>nvidia.com/gpu</code>. Sin él, para Kubernetes el nodo no tiene GPUs: ningún pod que las pida cabe, y Karpenter no lo considera inicializado.</p>` },
            { title: 'El pod pide la GPU', meta: 'scheduler', html: `<p><code>nvidia.com/gpu: 1</code> en <code>limits</code>. El scheduler lo pone en un nodo con una libre y el device plugin le asigna una GPU concreta.</p>` },
          ] },
          { t: 'table', caption: 'Las reglas del recurso extendido', head: ['Regla', 'Por qué importa'], rows: [
            ['Solo enteros: 1, 2… nunca 0.5', 'Sin MIG ni time-slicing, un pod ocupa la GPU completa aunque use el 5 %, como las T4 de c01 (<a href="#m04.compartir-gpu">M4</a>)'],
            ['Va en <code>limits</code>; si también va en <code>requests</code>, igual', 'No hay sobreasignación: dos pods nunca reciben la misma GPU por accidente'],
            ['Se cuenta por nodo', 'Un pod que pide 2 GPUs necesita un nodo con 2 libres; no junta una de cada nodo'],
          ] },
          { t: 'h3', text: 'Quién instala qué' },
          { t: 'table', head: ['Opción', 'Qué trae', 'Qué te falta', 'Cuándo'], rows: [
            ['AMI acelerada de EKS (AL2023 NVIDIA)', 'Driver, CUDA user-mode driver y Container Toolkit', 'El device plugin (lo instalas tú, p. ej. con Helm) y el exportador de métricas', 'EKS con node groups o Karpenter, como c01'],
            ['Bottlerocket NVIDIA (EKS)', 'Driver, toolkit y device plugin', 'El exportador de métricas', 'EKS con un sistema operativo mínimo'],
            ['EKS Auto Mode', 'Driver y device plugin gestionados por AWS (el plugin no aparece como DaemonSet)', 'Control de versiones', 'Quieres delegar los nodos por completo'],
            ['NVIDIA GPU Operator', 'Instala y gestiona driver (como contenedor), toolkit, device plugin, GPU Feature Discovery, DCGM exporter y MIG manager', 'Si la AMI ya trae driver y toolkit, desactivas esas partes', 'On-prem, varias nubes o un solo stack gestionado'],
            ['GKE', 'Puede instalar el driver al crear el node pool, pone el taint en los nodos GPU y agrega la toleration a los pods que piden GPU', '—', 'GKE Standard o Autopilot'],
          ] },
          { t: 'callout', kind: 'skip', html: `<p>Qué AMI trae qué componente es consulta, no algo que memorizar. En la entrevista basta con: el driver lo pone la imagen del nodo o el GPU Operator, y el device plugin anuncia la GPU al scheduler.</p>` },
          { t: 'callout', kind: 'note', title: 'DCGM exporter', html: `<p>Expone a Prometheus la utilización, la memoria usada, la temperatura, la potencia y los errores Xid de cada GPU. Lo necesitas para dashboards, para capacity planning y para drenar un nodo cuya GPU empieza a fallar. No lo uses como señal principal de autoscaling: la <a href="#m06.hpa">sección 4</a> explica por qué.</p>` },
          { t: 'h3', text: 'Node pools, labels, taints y tolerations' },
          { t: 'p', html: `Una g4dn.xlarge cuesta ${est('≈ US$0.526/h')} y tiene 4 vCPU. Si el scheduler pone ahí 3 pods de gateway porque "hay CPU libre", Triton (que pide 2 CPU) ya no cabe, y el autoscaler lanza otra máquina con GPU para correr… CPU. La regla: los nodos GPU son solo para pods que usan GPU. Se logra con dos mecanismos que empujan en direcciones opuestas:` },
          { t: 'table', head: ['Mecanismo', 'Qué hace', 'Dirección', 'En c01'], rows: [
            ['Label + <code>nodeSelector</code> (o node affinity)', '"Este pod solo puede ir a nodos con esta label"', 'Atrae al pod hacia ciertos nodos', '<code>workload: gpu-t4</code>: el engine se compiló para la T4 (sm_75)'],
            ['Taint + toleration', '"Este nodo rechaza a los pods que no toleren el taint"', 'Aleja a todos los demás', '<code>nvidia.com/gpu=present:NoSchedule</code>; Triton lo tolera'],
          ], note: 'Necesitas los dos. Sin el taint, los pods de CPU ocupan las máquinas caras. Sin el nodeSelector, Triton igual solo cabe en nodos con GPU (la pide), pero si mañana agregas un pool de L4, podría caer en una L4 donde su engine de T4 no carga. En EKS los configuras tú; GKE pone ese mismo taint en los node pools con GPU.' },
          { t: 'code', title: 'Lo mínimo para pedir una GPU', caption: 'Validado con kubernetes-validate --strict (1.34 y 1.36). Los tres bloques numerados son lo que se pregunta.', files: [
            { name: 'detector-gpu.yaml', lang: 'yaml', code: GPU_DEPLOY },
          ] },
          { t: 'h3', text: 'Cuando el pod se queda en Pending' },
          { t: 'table', head: ['Lo que ves en los eventos del pod (algo como)', 'Causa', 'Qué haces'], rows: [
            ['<code>0/6 nodes are available: 2 Insufficient nvidia.com/gpu, 4 node(s) didn\'t match Pod\'s node affinity/selector</code>', 'Las T4 existentes están ocupadas', 'Esperar al autoscaler de nodos (minutos) o revisar por qué no agrega: máximo del pool, cuota, capacidad'],
            ['<code>… node(s) had untolerated taint(s)</code>', 'El pod no tolera el taint de los nodos GPU', 'Agregar la toleration. Desde Kubernetes 1.34 el evento no dice cuál es el taint (hasta 1.33 lo nombraba): míralo en el nodo (<code>kubectl describe node NODO</code>, bloque Taints)'],
            ['El nodo existe pero su capacidad no muestra <code>nvidia.com/gpu</code>', 'El device plugin no corre o el driver falló', 'Revisar el DaemonSet del plugin y sus logs'],
            ['Pending mientras el autoscaler reporta falta de capacidad', 'EC2 no tiene ese tipo en esa zona (InsufficientInstanceCapacity) o se agotó la cuota', 'Más tipos y zonas permitidas (<a href="#m06.nodos">sección 6</a>)'],
          ], note: 'Los comandos para diagnosticarlo están en <a href="#ref-comandos.depurar">la hoja de comandos</a>.' },
          { t: 'h3', text: 'Bin packing y fragmentación' },
          { t: 'p', html: `En c01 no hay nada que empacar: 1 pod = 1 GPU = 1 nodo chico. El problema aparece con nodos grandes y pods de distintos tamaños. Tienes dos g4dn.12xlarge (4 T4 cada una) con 3 GPUs ocupadas en cada una: hay 2 GPUs libres en el cluster, pero un pod que pide 2 no cabe en ningún nodo. Eso es fragmentación, y es común al mezclar modelos que piden 1, 2 u 8 GPUs (LLMs con tensor parallelism, <a href="#m14">M14</a>). Mitigaciones: pools separados por tamaño de pod, nodos del tamaño del pod, y consolidación que reacomode lo que se pueda mover.` },
          { t: 'callout', kind: 'skip', html: `<p>Configurar time-slicing y MIG en el device plugin (réplicas por GPU, estrategias <code>single</code>/<code>mixed</code>, recursos como <code>nvidia.com/mig-1g.10gb</code>) y Dynamic Resource Allocation (DRA, estable desde Kubernetes 1.34: pedir dispositivos por atributos y compartirlos): basta con saber que existen. Según su propio README (sept. 2026), la parte de asignación de GPUs del driver DRA de NVIDIA todavía no tiene soporte oficial. En la entrevista alcanza con <code>nvidia.com/gpu</code>, node pools, taints y qué opción de compartir aísla qué (<a href="#m04.compartir-gpu">M4</a>).</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"Triton runs on a dedicated T4 node pool. A node selector pins it to the T4s the engine was built for, and a NoSchedule taint keeps CPU pods off the expensive GPU nodes. Each pod requests exactly one GPU through the NVIDIA device plugin."</p>` },
        ],
      },

      // ======================================================== 4
      {
        id: 'hpa',
        title: 'HPA: por qué escalar por CPU no sirve para un servicio de GPU',
        titleEn: 'HPA: why CPU-based scaling fails for a GPU service',
        priority: 'core',
        dims: ['arquitectura', 'monitoreo', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Primero el número. El gateway de c01 tiene 5 pods al 90 % de su request de CPU y un objetivo de 60 %: el HPA pide ceil(5 × 90 / 60) = ceil(7.5) = 8 pods. Esa es toda la fórmula:` },
          { t: 'kv', items: [
            ['réplicas = ceil(actuales × métrica / objetivo)', 'controlador proporcional', 'Con varias métricas, calcula una cifra por métrica y se queda con la mayor'],
          ] },
          { t: 'calc', title: 'El HPA del gateway de c01 en tres momentos', rows: [
            { label: 'Sube la CPU en el pico', expr: 'ceil(5 × 90 / 60) = ceil(7.5)', value: '8 pods' },
            { label: 'Cerca del objetivo', expr: '8 pods al 64 %: 64 / 60 ≈ 1.07, dentro de la tolerancia de 10 %', value: 'sin cambio' },
            { label: 'Pasó el pico', expr: '8 pods al 30 %: 8 × 30 / 60', value: '4 pods', note: 'tras la ventana de estabilización y a la velocidad que permita behavior' },
          ], result: 'Funciona porque la métrica sube cuando el pod se satura: el trabajo del gateway es CPU. Todo el problema de esta sección está en esa condición.' },
          { t: 'h3', text: 'Los tiempos del HPA' },
          { t: 'table', head: ['Parámetro', 'Default', 'Efecto'], rows: [
            ['Período de sincronización', '15 s (<code>--horizontal-pod-autoscaler-sync-period</code>)', 'Cada cuánto recalcula'],
            ['Tolerancia', '10 %', 'No actúa si métrica / objetivo está entre 0.9 y 1.1. El campo <code>tolerance</code> por HPA existe desde 1.33 como alpha y es estable desde 1.37'],
            ['Subida', 'Sin ventana; hasta +100 % o +4 pods cada 15 s (gana el mayor)', 'Sube de inmediato'],
            ['Bajada', 'Ventana de 300 s; hasta −100 % cada 15 s', 'Usa la recomendación más alta de los últimos 5 min: baja despacio y no oscila'],
            ['Pods arrancando', 'Ignora la CPU de pods no listos (<code>cpu-initialization-period</code> 5 min, <code>initial-readiness-delay</code> 30 s)', 'El pico de CPU del arranque no dispara más escalado'],
          ], note: 'Todo se ajusta por HPA en <code>behavior</code>. c01: el gateway sube hasta +100 % cada 30 s y baja 1 pod por minuto tras 300 s; Triton sube 1 pod por minuto y baja 1 cada 5 min tras 600 s. Desde Kubernetes 1.37 (agosto de 2026) el HPA nativo también puede bajar a cero con métricas object o external (beta, activado por defecto); los clusters gestionados suelen ir una o dos versiones atrás.' },
          { t: 'callout', kind: 'skip', html: `<p>Esta tabla es consulta: no memorices flags ni defaults. En la entrevista basta con la fórmula y con que el HPA sube rápido y baja despacio, con una ventana de estabilización para no oscilar.</p>` },
          { t: 'h3', text: 'El argumento central, con números' },
          { t: 'p', html: `Un pod de Triton de c01 pide 2 CPU. Usa CPU para recibir los requests por HTTP, deserializar los tensores y armar los batches: trabajo proporcional a los requests que <b>completa</b>. Supón ${est('≈ 0.5 cores por cada 1,000 img/s')} (es un supuesto: se mide con <code>kubectl top</code> y cambia con el protocolo). La GPU llega a su codo en ≈ 1,200 img/s (<a href="#m03.load-testing">M3</a>). Ahora sube la carga sobre ese pod:` },
          { t: 'table', caption: 'Un pod de Triton (una T4) bajo carga creciente. Números ILUSTRATIVOS, con la forma que vas a ver', head: ['Carga ofrecida', 'Throughput real', 'CPU del pod (% del request)', 'Espera en la cola de Triton', 'Qué pasa', '¿HPA por CPU al 60 % escala?'], rows: [
            ['250 img/s', '250', '≈ 6 %', est('≈ 1–3 ms'), 'Pico de diseño de c01, por GPU', 'No (y está bien)'],
            ['600 img/s', '600', '15 %', est('≈ 2–4 ms'), 'La capacidad planeada (50 %)', 'No'],
            ['900 img/s', '900', '≈ 23 %', est('≈ 3–8 ms'), 'La curva empieza a doblarse', 'No'],
            ['1,300 img/s', '≈ 1,210', '≈ 30 %', '≈ 100 ms (el tope de la cola)', 'Saturada: ≈ 7 % de rechazos', 'No'],
            ['1,600 img/s', '≈ 1,210', '≈ 30 %', 'en el tope', '≈ 24 % de rechazos y p99 fuera del SLO', 'No: la CPU ya no puede subir'],
          ], note: 'La CPU sigue al throughput completado, y el throughput se aplana cuando la GPU se satura. La señal se congela justo cuando más la necesitas: con ceil(1 × 30 / 60) = 1, el HPA ve un pod a la mitad de su objetivo mientras se rechaza uno de cada cuatro requests.' },
          { t: 'callout', kind: 'why', title: 'La regla general', html: `<p>Escala con una señal del recurso que se satura primero. En el gateway es la CPU, así que el HPA por CPU de c01 es correcto ahí. En Triton es la GPU, y la CPU del pod es solo un reflejo de cuánto trabajo terminó. El entrevistador anota si sabes <b>por qué</b> separas las señales por tier, no si sabes que "para GPU se usan métricas custom".</p>` },
          { t: 'callout', kind: 'trap', title: '"Bajo el objetivo a 20 % y listo"', html: `<p>Así el HPA escala, pero por throughput disfrazado: el disparo quedaría en ${est('≈ 800 img/s')} por pod solo porque Triton gasta ≈ 0.5 cores por cada 1,000 img/s. Ese número se mueve sin que nadie toque el HPA: si pasas de HTTP binario a JSON o a gRPC, o cambias de versión de Triton, el mismo 20 % significa otro throughput. Es una métrica proxy con un número mágico. Si vas a escalar por throughput, hazlo explícito: QPS por réplica contra la capacidad planeada por GPU (tabla de abajo).</p>` },
          { t: 'h3', text: 'nvidia-smi dice 100 % y no significa lleno' },
          { t: 'p', html: `La "utilización" de <code>nvidia-smi</code>, <code>DCGM_FI_DEV_GPU_UTIL</code> y <code>nv_gpu_utilization</code> de Triton es la fracción del tiempo en que hubo al menos un kernel corriendo. Falla en las dos direcciones. Con tráfico de batch 1 puede marcar 30–40 % cuando la GPU haría varias veces más con batches grandes (<a href="#m03.colas-utilizacion">M3</a>). Y una vez que la GPU está ocupada todo el tiempo marca ≈ 100 % igual con 2 requests en cola que con 200: no dice cuánto esperan ni cuánto throughput queda si los batches crecen. Las métricas de profiling de DCGM (<code>DCGM_FI_PROF_SM_ACTIVE</code>, <code>DCGM_FI_PROF_PIPE_TENSOR_ACTIVE</code>) miden mejor cuánto del chip trabaja, pero tampoco ven la cola. Úsalas para dashboards y capacity planning.` },
          { t: 'table', caption: 'Señales para escalar un servicio de GPU', head: ['Señal', 'Qué mide', 'Cómo entra al HPA', 'A favor', 'En contra'], rows: [
            ['Tiempo en cola (c01)', 'Cuánto esperan los requests antes de la GPU', 'Valor absoluto (<code>Value</code>): réplicas proporcionales a espera / objetivo', 'Es el síntoma que sienten el usuario y el SLO', 'No lineal: casi 0 hasta saturar y después salta (c01 lo compensa bajando despacio)'],
            ['Requests en espera o en vuelo por réplica', '<code>nv_inference_pending_request_count</code>, o los requests en vuelo del gateway', 'Promedio por pod (<code>AverageValue</code>)', 'Proporcional a la carga; reacciona rápido', 'El objetivo sale de Little (<a href="#m03.little">M3</a>), y hay que recalcularlo si cambia el modelo'],
            ['QPS por réplica', 'Throughput que llega', '<code>AverageValue</code> por debajo de la capacidad planeada por GPU, para que la réplica nueva llegue antes de pasarla: c01 sugiere ≈ 400 img/s por réplica contra sus 600 planeados (≈ 2/3)', 'Estable, lineal, fácil de explicar', 'No ve cambios en el costo por request (fotos más grandes, un modelo más lento): se recalibra con cada load test'],
            ['Utilización de GPU', 'Tiempo ocupado', 'Porcentaje', 'Viene gratis con DCGM', 'Engañosa (arriba)'],
            ['CPU del pod de GPU', 'Trabajo de CPU del pod', 'Recurso nativo', 'Viene de fábrica', 'Se congela cuando la GPU se satura'],
          ], note: 'Las plataformas de serving usan estas mismas filas. KServe en modo Knative escala con el autoscaler de Knative (KPA) por concurrencia (requests en vuelo por pod: <code>scaleMetric</code> y <code>scaleTarget</code>) y puede bajar a cero con el activator reteniendo los requests; en modo Standard usa HPA o KEDA. Ray Serve escala por <code>target_ongoing_requests</code> por réplica. SageMaker hace target tracking sobre invocaciones por instancia por minuto o, con métricas cada 10 s, sobre requests concurrentes por modelo. Servidores y protocolos: <a href="#m07">M7</a>. En LLMs, las señales equivalentes son los requests esperando en el motor de inferencia y el uso del KV cache (<a href="#m14">M14</a>).' },
          { t: 'h3', text: 'Cómo llega una métrica custom al HPA' },
          { t: 'p', html: `El HPA no habla con Prometheus. Lee tres APIs del cluster: <code>metrics.k8s.io</code> (CPU y memoria, las publica Metrics Server), <code>custom.metrics.k8s.io</code> (métricas de objetos del cluster, como pods) y <code>external.metrics.k8s.io</code> (cosas de afuera: una cola, una query). Alguien tiene que publicarlas: <b>Prometheus Adapter</b> traduce queries de Prometheus a métricas custom; <b>KEDA</b> publica métricas external. Solo puede haber un servidor de métricas external por cluster, así que KEDA no convive con otro adaptador que también las publique.` },
          { t: 'code', title: 'HPA con una métrica custom por pod', caption: 'Validado con kubernetes-validate --strict. Supone una regla de Prometheus Adapter que publica <code>triton_pending_requests</code>. c01 hace lo equivalente con KEDA (siguiente sección): no pongas dos autoscalers sobre el mismo Deployment, pelearían por el número de réplicas.', files: [
            { name: 'hpa-triton-custom.yaml', lang: 'yaml', code: HPA_CUSTOM },
          ] },
          { t: 'callout', kind: 'skip', html: `<p>VPA (autoscaling vertical) rara vez aplica al serving en GPU: la GPU no se redimensiona. Si te lo preguntan, basta con saber que existe y que el cambio de recursos sin reiniciar el pod (in-place resize) es estable desde Kubernetes 1.35.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"I wouldn't scale Triton on CPU: its CPU tracks completed requests, so it flattens exactly when the GPU saturates. I scale on queue time instead, which is the symptom the SLO cares about, and I keep the gateway on CPU because its bottleneck really is CPU."</p>` },
          { t: 'callout', kind: 'connect', html: `<p>Por qué la cola casi no crece y después se dispara: ρ / (1 − ρ) en <a href="#m03.colas-utilizacion">M3</a>. La decisión por tier de c01 y la alerta sobre el tiempo en cola, en <a href="#c01.serving">su sección de serving</a> y <a href="#c01.monitoreo">su monitoreo</a>. Los comandos (<code>kubectl get hpa</code>, <code>kubectl top</code>, eventos), en <a href="#ref-comandos.autoscaling-cmds">la hoja de comandos</a>.</p>` },
        ],
      },

      // ======================================================== 5
      {
        id: 'keda',
        title: 'KEDA: escalar por eventos y hasta cero',
        titleEn: 'KEDA: event-driven autoscaling and scale to zero',
        priority: 'core',
        dims: ['arquitectura', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `KEDA no reemplaza al HPA: lo crea y lo alimenta. Escribes un <b>ScaledObject</b> que apunta a tu Deployment y dice qué evento mirar (una query de Prometheus, una cola de SQS, el lag de Kafka). KEDA crea un HPA llamado <code>keda-hpa-&lt;nombre&gt;</code>, le publica la métrica como external y se encarga él mismo del paso de 0 a 1 réplicas y de 1 a 0, que el HPA nativo no hacía por defecto hasta Kubernetes 1.37. De 1 a N escala el HPA, con la misma fórmula y el mismo <code>behavior</code> de la sección anterior.` },
          { t: 'table', head: ['Fase', 'Quién decide', 'Con qué', 'Defaults'], rows: [
            ['Activación (0 ↔ 1)', 'KEDA', 'El umbral de activación de cada trigger (<code>activationThreshold</code>, <code>activationQueueLength</code>…): activa si la métrica lo supera', 'Activación en 0; <code>cooldownPeriod</code> 300 s antes de volver a 0; <code>pollingInterval</code> 30 s'],
            ['Escalado (1 ↔ N)', 'El HPA que creó KEDA', 'ceil(actuales × métrica / objetivo), con <code>Value</code> o <code>AverageValue</code>', 'Sync del HPA cada 15 s'],
          ], note: 'Si <code>minReplicaCount</code> es 1 o más, la activación no aplica y el HPA maneja todo. <code>minReplicaCount</code> vale 0 por defecto y <code>maxReplicaCount</code>, 100.' },
          { t: 'table', caption: 'ScaledObject vs ScaledJob', head: ['', 'ScaledObject', 'ScaledJob'], rows: [
            ['Qué escala', 'Réplicas de un Deployment (procesos de larga vida)', 'Crea Jobs según los mensajes pendientes'],
            ['Al bajar', 'El HPA baja las réplicas y el ReplicaSet elige qué pods borrar sin mirar qué hacen: puede ser uno a mitad de un mensaje', 'No mata trabajo: cada Job termina lo suyo'],
            ['Modelo en memoria', 'Se carga una vez y atiende muchos mensajes', 'Cada Job lo carga de nuevo: un cold start por job'],
            ['Bueno para', 'Serving online y consumidores de mensajes cortos', 'Jobs largos: un video de 10 min, un PDF de 200 páginas, un entrenamiento'],
          ] },
          { t: 'table', caption: 'Los triggers que vas a nombrar', head: ['Trigger (<code>type</code>)', 'Qué mide', 'Parámetro clave', 'Ojo'], rows: [
            ['<code>prometheus</code>', 'Cualquier query de PromQL', '<code>query</code>, <code>threshold</code>, <code>metricType</code>', '<code>ignoreNullValues</code> vale <code>true</code> por defecto: si la query vuelve vacía, KEDA la toma como 0 y nadie se entera. c01 lo pone en <code>"false"</code>'],
            ['<code>aws-sqs-queue</code>', 'Mensajes visibles + en proceso (los "not visible")', '<code>queueLength</code> (default 5) = mensajes por réplica', 'No tiene modo de "edad del mensaje más viejo": escala por profundidad. La edad es tu alerta (<a href="#m02.asincrona-colas">M2</a>)'],
            ['<code>kafka</code>', 'Lag total del consumer group', '<code>lagThreshold</code> (default 10)', 'Por defecto no pasa del número de particiones: más consumers que particiones quedarían ociosos'],
            ['<code>gcp-pubsub</code>', 'Mensajes sin entregar o edad del más viejo (<code>mode: OldestUnackedMessageAge</code>)', '<code>mode</code>, <code>value</code>', 'Deprecado desde septiembre de 2025: KEDA recomienda el trigger <code>prometheus</code> contra el endpoint PromQL de Cloud Monitoring'],
            ['<code>cron</code>', 'Un horario', '<code>start</code>, <code>end</code>, <code>desiredReplicas</code>, <code>timezone</code>', 'Escalado programado (<a href="#m06.cold-starts">sección 7</a>)'],
          ] },
          { t: 'h3', text: 'c01: KEDA sobre la cola de Triton' },
          { t: 'calc', title: 'Qué pide el ScaledObject de c01 (metricType: Value, objetivo 10 ms)', rows: [
            { label: 'Normal', expr: 'ceil(2 × 2 ms / 10 ms) = ceil(0.4)', value: '1 → se queda en 2', note: 'manda minReplicaCount: N+1' },
            { label: 'La GPU se satura', expr: 'ceil(2 × 25 / 10)', value: '5 → 4', note: 'maxReplicaCount: techo de costo' },
            { label: 'Velocidad', expr: 'behavior: +1 pod cada 60 s', value: '3 al primer minuto, 4 al segundo', note: 'más lo que tarde cada nodo nuevo' },
          ], result: 'Con <code>Value</code> la respuesta es proporcional a la espera, como corresponde a un tiempo. Con <code>AverageValue</code> el HPA dividiría la métrica entre las réplicas, lo que tiene sentido para un caudal (req/s), no para una latencia. El archivo completo, comentado, está en <a href="#c01.archivos">c01</a>.' },
          { t: 'callout', kind: 'trap', title: 'Escalaste y el pod nuevo no recibe tráfico', html: `<p>Que KEDA cree la réplica no significa que la carga se reparta. El Service balancea conexiones (L4), no requests: con gRPC (una conexión HTTP/2 larga) o con un pool keep-alive que no rota, las conexiones existentes siguen pegadas a los pods viejos, el pod nuevo queda casi ocioso y la cola sigue alta. Las salidas (headless service con balanceo en el cliente, un mesh L7 o una vida máxima de conexión) están en <a href="#c01.serving">c01 · serving</a>. Y con ruteo por zona hay un segundo motivo, que ves en la <a href="#m06.alta-disponibilidad">sección 9</a>.</p>` },
          { t: 'h3', text: 'Workers GPU que leen de una cola' },
          { t: 'p', html: `El patrón asíncrono de <a href="#m02.asincrona-colas">M2</a>: aceptas 300 s de espera en cola y cada worker tarda ${est('≈ 20 s')} por job, así que cada worker puede tener 15 mensajes delante: <code>queueLength: 15</code>. SQS reporta 120 mensajes (visibles + en proceso):` },
          { t: 'calc', title: 'Cuántos workers pide KEDA (AverageValue)', rows: [
            { label: 'Objetivo por worker', expr: '300 s de espera aceptable / ≈ 20 s por job', value: '15 mensajes' },
            { label: 'Mensajes en SQS', expr: 'visibles + en proceso', value: '120' },
            { label: 'Workers deseados', expr: 'ceil(120 / 15)', value: '8' },
            { label: 'Espera del último mensaje', expr: '15 × ≈ 20 s', value: '≈ 300 s: el SLO' },
          ], result: 'Proporcional: el doble de backlog pide el doble de workers, hasta <code>maxReplicaCount</code>. De noche, sin mensajes, baja a cero después del <code>cooldownPeriod</code>.' },
          { t: 'code', title: 'ScaledObject para workers GPU sobre SQS', caption: 'Validado contra el esquema de los CRDs de KEDA 2.21.0 (campos desconocidos = error).', files: [
            { name: 'keda-ocr-workers.yaml', lang: 'yaml', code: KEDA_SQS },
          ] },
          { t: 'callout', kind: 'trap', title: 'Un worker apagado a mitad de un job', html: `<p>Con un ScaledObject, cuando el backlog baja, el HPA reduce las réplicas y el ReplicaSet borra pods sin mirar qué están haciendo. Contar los mensajes en proceso no lo evita: 8 workers con un mensaje cada uno y la cola visible vacía dan 8 mensajes, ceil(8 / 15) = 1 réplica, y a los 5 min de ventana hasta 7 workers reciben SIGTERM a mitad de su job. Un worker que recibe SIGTERM a los 15 s de un video de 10 min pierde su trabajo, el mensaje vuelve a ser visible cuando vence el visibility timeout y otro worker empieza de cero. Tres defensas: un <code>terminationGracePeriodSeconds</code> mayor que el job más largo y un worker que, al recibir SIGTERM, termina el mensaje actual y no toma otro; ScaledJob para los jobs largos; y jobs idempotentes, porque el reprocesamiento va a pasar igual (<a href="#m02.entrega-reintentos">M2</a>).</p>` },
          { t: 'h3', text: 'Escalar a cero: el precio' },
          { t: 'p', html: `A cero no pagas GPU mientras nadie la usa. El primer request después de cero paga el cold start completo: nodo nuevo, imagen de varios GB y carga del modelo, ${est('varios minutos')} (<a href="#m06.cold-starts">sección 7</a>). AWS lo dice así en la documentación de los endpoints de SageMaker que bajan a cero: mientras vuelve a aprovisionar una instancia, que tarda minutos, las invocaciones fallan.` },
          { t: 'table', head: ['Carga', '¿A cero?', 'Por qué'], rows: [
            ['c01: síncrona, 24/7, p99 ≤ 200 ms', 'No: mínimo 2', 'Nunca baja de decenas de req/s, y un cold start de minutos no cabe en un timeout de 300 ms'],
            ['Workers de OCR propio en GPU con SLO de minutos', 'Sí', 'La cola absorbe la espera; noches y fines de semana sin GPU (<a href="#c05">c05</a> no llega a esto: usa un OCR gestionado y CPU, con al menos 2 réplicas por disponibilidad)'],
            ['Backfill o scoring nocturno (<a href="#m02.batch">M2</a>)', 'Sí, con Job o ScaledJob', 'Arranca, termina y se apaga'],
            ['Modelo interno que se usa 2 h al día', 'Depende', 'Si quien lo usa tolera esperar el primer minuto; si no, mínimo 1 en horario (trigger cron)'],
          ] },
          { t: 'callout', kind: 'trap', title: 'El minReplicaCount que no escribiste', html: `<p>El default de <code>minReplicaCount</code> en KEDA es 0. Un ScaledObject para un servicio online que no lo declara baja a cero a las 3 a. m. y el primer usuario de la mañana se come el cold start. Escríbelo siempre, aunque sea el valor que quieres.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"The async workers scale on queue depth through KEDA, from zero to eight, with a target of fifteen messages per worker that comes from the wait we accept. The online Triton tier never goes to zero: the first request after zero would pay a cold start of several minutes."</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'nodos',
        title: 'Aprovisionar nodos GPU: Cluster Autoscaler y Karpenter',
        titleEn: 'Provisioning GPU nodes: Cluster Autoscaler and Karpenter',
        priority: 'core',
        dims: ['arquitectura', 'estimaciones'],
        blocks: [
          { t: 'p', html: `El HPA y KEDA agregan pods, no máquinas. Si ningún nodo tiene una GPU libre, el pod nuevo queda Pending, y otro controlador tiene que ver ese pod y traer un nodo. Son dos lazos con tiempos muy distintos: el de pods reacciona en segundos; el de nodos, en minutos.` },
          { t: 'diagram', id: 'lazos-autoscaling', title: 'Los dos lazos del autoscaling en c01', caption: 'Arriba, el lazo de pods (KEDA y el HPA); abajo, el de nodos. Toca cada caja para ver qué hace y recorre los tres flujos: escalar sin GPU libre, escalar con un nodo de reserva y bajar después del pico.', spec: LAZOS },
          { t: 'table', caption: 'Cluster Autoscaler vs Karpenter', head: ['', 'Cluster Autoscaler', 'Karpenter'], rows: [
            ['Qué escala', 'Node groups (Auto Scaling Groups en AWS): subir o bajar el tamaño de grupos de máquinas iguales', 'Instancias sueltas: por cada tanda de pods pendientes elige qué lanzar y la pide a la API de EC2 (sin ASG)'],
            ['Tipos de instancia', 'Los que definiste en cada grupo; varios tipos, varios grupos', 'Una lista de requisitos (familia, GPU, zona, on-demand o spot); lanza la opción más barata que cumple'],
            ['Dónde corre', 'AWS, GCP, Azure y otros: proyecto de SIG Autoscaling de Kubernetes', 'AWS (su proyecto principal) y Azure (base del node autoprovisioning de AKS); GKE usa su propio autoscaler'],
            ['Al bajar', 'Quita nodos subutilizados después de 10 min (default)', 'Consolidación: quita nodos vacíos o los reemplaza por otros más baratos, según la política de cada NodePool'],
            ['Falta de capacidad', 'El grupo reintenta; se combina con varios grupos y un expander por prioridad', 'Aparta esa combinación de tipo, zona y modalidad por unos minutos y prueba otra de la lista'],
          ], note: 'Los dos reaccionan a pods Pending, y con GPUs los dos tardan minutos. Se dice que Karpenter reacciona más rápido porque no pasa por un ASG; no tengo un benchmark confiable que lo cuantifique: mide el tiempo de Pending a Ready en tu cluster.' },
          { t: 'callout', kind: 'skip', html: `<p>No memorices flags (<code>--scan-interval</code>, expanders) ni la estructura completa de NodePool y EC2NodeClass. Lo que sí debes poder decir: los pods no escalan más allá de los nodos que existen, el autoscaler de nodos reacciona a pods Pending, y un nodo GPU nuevo tarda minutos.</p>` },
          { t: 'h3', text: 'La GPU que no llega' },
          { t: 'p', html: `Las GPUs son el recurso que más falta en la nube. EC2 puede responder <code>InsufficientInstanceCapacity</code> para un tipo en una zona, y tu cuenta tiene una cuota de vCPUs por familia (instancias G y VT) que en cuentas nuevas suele arrancar baja. Un autoscaler configurado hasta 20 réplicas no te da 20 GPUs. Qué haces en el diseño:` },
          { t: 'list', items: [
            `<b>Varios tamaños de la misma GPU.</b> El engine de c01 está compilado para la T4 (sm_75): puedes permitir g4dn.xlarge y g4dn.2xlarge, pero no una L4 sin otro engine (<a href="#m08">M8</a>). La diversificación está limitada por el artefacto del modelo.`,
            `<b>Varias zonas.</b> Cada zona es otra reserva de capacidad. c01 permite sus 2 zonas; sumar una 3.ª al pool de GPU solo sirve si también llevas gateways ahí, porque con ruteo por zona un Triton sin gateways en su zona no recibe tráfico (<a href="#m06.alta-disponibilidad">sección 9</a>).`,
            `<b>Cuota pedida antes.</b> Para el máximo del autoscaler más el surge de un deploy más la reserva, no para el mínimo.`,
            `<b>Capacidad reservada para lo crítico.</b> Una reserva de capacidad on-demand garantiza instancias en una zona y se paga se use o no. Un Savings Plan es un descuento, no una reserva: no te asegura que haya GPUs.`,
            `<b>Alertas.</b> Pods Pending por más de unos minutos y un autoscaler en su máximo son alertas, no curiosidades.`,
          ] },
          { t: 'h3', text: 'Overprovisioning: un nodo caliente que se paga siempre' },
          { t: 'p', html: `Si los spikes duran menos que un cold start de nodo, o si cada deploy con <code>maxSurge: 1</code> espera minutos por una GPU, mantienes un nodo de reserva ocupado por un pod placeholder de prioridad muy baja. Cuando llega un pod real, el scheduler desaloja al placeholder y le da su nodo; el placeholder queda Pending y dispara, en segundo plano, el nodo de la próxima reserva. Funciona con Cluster Autoscaler (con prioridad −10, su corte por defecto) y con Karpenter. El precio: una T4 más, ${est('≈ US$384/mes')} on-demand, el mismo número que usa c01 al evaluarlo.` },
          { t: 'code', title: 'Un NodePool de T4 y un nodo de reserva', caption: 'NodePool validado contra el CRD de Karpenter 1.14.1; PriorityClass y Deployment, con kubernetes-validate --strict.', files: [
            { name: 'nodepool-gpu-t4.yaml', lang: 'yaml', code: NODEPOOL, note: '<code>consolidationPolicy: WhenEmpty</code> es conservador a propósito: el default de Karpenter (<code>WhenEmptyOrUnderutilized</code>) también reemplaza nodos subutilizados, lo que en un tier de GPU significa reiniciar un Triton para ahorrar. El PDB lo acota, pero un pod de GPU tarda en volver.' },
            { name: 'reserva-gpu.yaml', lang: 'yaml', code: RESERVA },
          ] },
          { t: 'h3', text: 'Spot solo para lo que tolera interrupciones' },
          { t: 'p', html: `Las instancias spot con GPU salen bastante más baratas (el descuento varía por tipo, zona y momento: verifícalo), a cambio de que AWS puede recuperarlas con 2 minutos de aviso. Karpenter escucha esos avisos (con una cola de interrupciones configurada), drena el nodo y lanza el reemplazo en paralelo. Encaja en lo que puede repetirse: backfills, scoring batch, workers asíncronos con jobs idempotentes y entrenamiento con checkpoints. No encaja en el mínimo de un tier online como el de c01: esas réplicas van on-demand. El patrón común: base on-demand para el serving, spot para todo lo batch (<a href="#m02.batch">M2</a>, <a href="#m13">M13</a>).` },
          { t: 'callout', kind: 'interview', html: `<p>"Pods can't scale past the nodes we have, so there are two loops: KEDA adds Triton replicas in seconds, and Karpenter adds T4 nodes in minutes. GPU capacity can run out in a zone, so the node pool allows more than one T4 size in each of our two zones, and we raise the vCPU quota ahead of time."</p>` },
        ],
      },

      // ======================================================== 7
      {
        id: 'cold-starts',
        title: 'Cold starts de punta a punta',
        titleEn: 'Cold starts end to end',
        priority: 'core',
        dims: ['estimaciones', 'arquitectura'],
        blocks: [
          { t: 'p', html: `En <a href="#m03.trafico">M3</a> quedó escrito que el autoscaler no absorbe un spike. Aquí está el porqué, tramo por tramo. Un scale-out de Triton cuando no hay un nodo GPU libre:` },
          { t: 'calc', title: 'Del primer síntoma al primer request servido (c01, sin nodo libre)', rows: [
            { label: '1. Detectar', expr: 'scrape (15 s en c01) + lo que tarda el promedio de 2 min en cruzar 10 ms (si la espera salta de 2 a 25 ms: (10 − 2) / (25 − 2) × 120 s ≈ 42 s) + sync del HPA (15 s)', value: est('≈ 0.5–1.5 min'), note: '15 + 42 + 15 ≈ 72 s; menos si el salto es mayor, más si la saturación llega de a poco' },
            { label: '2. Decidir y crear el pod', expr: 'HPA sin ventana de subida; queda Pending', value: 'segundos' },
            { label: '3. Nodo GPU nuevo', expr: 'lanzar la instancia, bootear, unirse al cluster, driver y device plugin listos', value: est('≈ 2–5 min'), note: 'más si el driver se instala al arrancar' },
            { label: '4. Descargar la imagen', expr: '≈ 9.2 GB ÷ ≈ 0.03–0.09 GB/s efectivos (<a href="#m05.tamano">M5</a>)', value: est('≈ 2–5 min'), note: 'más con el registry en otra región, una imagen más grande o si el kubelet baja las imágenes de a una (<code>serializeImagePulls: true</code>, su default) y en el nodo nuevo van primero las de los DaemonSets; ≈ 0 si viene precargada en la AMI' },
            { label: '5. Arrancar Triton, cargar el engine y warmup', expr: 'ResNet-50 FP16: MB de pesos', value: est('≈ 10–60 s'), note: 'minutos con pesos de decenas de GB (<a href="#m04.vram">M4</a>)' },
            { label: '6. Readiness y endpoints', expr: 'probe cada 5 s + propagación al Service', value: est('≈ 5–15 s') },
            { label: 'Total', expr: 'mínimos: 0.5 + 2 + 2 + 0.2 + 0.1 ≈ 4.8 min · máximos: 1.5 + 5 + 5 + 1 + 0.25 ≈ 12.8 min', value: est('≈ 5–13 min') },
          ], result: 'Varios minutos, con mucha varianza. Tus números salen de los eventos del cluster: la hora del cambio de réplicas del HPA, la del pod Pending, el nodo Ready, los eventos Pulling/Pulled de la imagen y la primera readiness exitosa (<a href="#ref-comandos.autoscaling-cmds">comandos</a>).' },
          { t: 'callout', kind: 'why', title: 'La consecuencia de diseño', html: `<p>El autoscaling reacciona en minutos y tus spikes duran segundos. La push notification de <a href="#m03.trafico">M3</a> (≈ 1,670 req/s durante un minuto) termina antes de que exista el primer nodo nuevo; la aguantan las dos T4 que ya estaban, al ≈ 70 % de su máximo medido. Por eso el orden es: headroom para los spikes (<a href="#m03.colas-utilizacion">M3</a>), autoscaling para la curva del día, escalado programado para los picos que conoces y load shedding con fallback para lo que no (<a href="#m03.timeouts-reintentos">M3</a>).</p>` },
          { t: 'table', caption: 'Qué acorta cada tramo', head: ['Tramo', 'Palanca', 'Qué ganas', 'Precio'], rows: [
            ['Detección', 'Scrape y ventanas más cortas; una señal que reacciona antes (requests en espera en vez de un promedio de 2 min)', 'Decenas de segundos', 'Más ruido: más riesgo de oscilar'],
            ['Nodo', 'Nodo de reserva (<a href="#m06.nodos">sección 6</a>); réplicas mínimas', 'Los 2–5 min completos', 'Un nodo pagado siempre'],
            ['Imagen', 'Precargarla en la AMI del nodo o con un DaemonSet; una imagen más chica; carga perezosa de capas (<a href="#m05.tamano">M5</a>)', 'El pull entero: ≈ 2–5 min en c01', 'Un pipeline de AMIs que mantener y reconstruir en cada versión'],
            ['Modelo', 'Pesos en la imagen o en disco local; un formato que carga rápido; el engine ya compilado, nunca compilado al arrancar (<a href="#m05.pesos-modelo">M5</a>)', 'De segundos a minutos', 'Imágenes más grandes: choca con el tramo anterior'],
            ['Todos', 'Escalado programado antes del pico conocido', 'Todo: la capacidad ya está cuando llega el tráfico', 'Pagas horas de más'],
          ] },
          { t: 'h3', text: 'Cómo se prepara c01 para el pico y para un Hot Sale' },
          { t: 'steps', items: [
            { title: 'Base', meta: 'siempre', html: `<p>Mínimo 2 T4 en 2 zonas: cada una aguanta sola el pico de diseño al ≈ 42 % de su máximo medido. Ese es el headroom que absorbe los spikes cortos.</p>` },
            { title: 'Pico diario', meta: 'opcional', html: `<p>Un trigger cron que sube a 3 réplicas de 18:30 a 23:00, antes del pico de las 20:00: si una GPU falla en el pico, sigue habiendo N+1. Cuesta ${est('≈ US$71/mes')} (0.526 × 4.5 h × 30 días). No está en c01: es la opción que agregarías si la caída de una GPU en el pico no fuera aceptable.</p>` },
            { title: 'Evento conocido', meta: 'días antes', html: `<p>Para un Hot Sale: subir los mínimos el día anterior, confirmar cuota y capacidad en ambas zonas, subir los máximos de los autoscalers (los de c01 están pensados para su tráfico normal), precargar imágenes y correr un load test con la carga esperada.</p>` },
            { title: 'Lo que no conoces', meta: 'siempre', html: `<p>Load shedding (503 rápido) y el fallback del caller (el selector manual de categorías). Es la respuesta para todo lo que llega más rápido que un nodo.</p>` },
          ] },
          { t: 'code', title: 'Escalado programado sobre el ScaledObject de c01', caption: 'Validado contra el esquema de los CRDs de KEDA 2.21.0. Es <code>k8s/keda-triton.yaml</code>, sin sus comentarios, más el trigger cron.', files: [
            { name: 'keda-triton-cron.yaml', lang: 'yaml', code: KEDA_CRON },
          ] },
          { t: 'callout', kind: 'trap', title: '"Tenemos autoscaling hasta 20, así que aguantamos cualquier pico"', html: `<p><code>maxReplicaCount</code> es un techo, no una capacidad. Cada réplica nueva necesita un nodo que tarda minutos, una cuota que alcance y capacidad en la zona. Un plan de capacidad dice qué hay encendido cuando llega el pico, no hasta dónde podría crecer.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"A GPU scale-out takes several minutes end to end: a new node, a multi-gigabyte image pull and the model load. So autoscaling follows the daily curve, while headroom and load shedding absorb spikes that last seconds, and for known peaks I scale ahead on a schedule."</p>` },
          { t: 'callout', kind: 'connect', html: `<p>El desglose del cold start de c01 y sus mitigaciones, en <a href="#c01.serving">su sección de serving</a>. Por qué las imágenes con CUDA pesan tanto y cómo achicarlas, en <a href="#m05.tamano">M5</a>. En LLMs, cargar decenas de GB de pesos domina todo el tramo 5 (<a href="#m14">M14</a>, <a href="#c10">c10</a>).</p>` },
        ],
      },

      // ======================================================== 8
      {
        id: 'serverless',
        title: 'Serverless y sus límites con GPU',
        titleEn: 'Serverless and its GPU limits',
        priority: 'core',
        dims: ['tradeoffs', 'estimaciones'],
        blocks: [
          { t: 'p', html: `Serverless significa que pagas por uso (por segundo o por request) y el proveedor escala por ti, a veces hasta cero. En la entrevista son dos preguntas separadas: ¿el servicio tiene GPU?, y ¿el modelo de costo y de arranque encaja con tu tráfico? Los datos cambian seguido; estos son de septiembre de 2026.` },
          { t: 'table', head: ['Servicio', 'GPU', 'Límites que importan', '¿A cero?', 'Para qué sí'], rows: [
            ['AWS Lambda', 'No (tampoco Lambda Managed Instances, que usa familias de CPU)', 'Hasta 10,240 MB de memoria, 15 min por invocación, imagen de hasta 10 GB sin comprimir, payload síncrono de 6 MB', 'Sí', 'Modelos chicos en CPU (tabulares, clasificadores ligeros), pre y postproceso, orquestar un pipeline'],
            ['SageMaker Serverless Inference', 'No', '1–6 GB de memoria, imagen de hasta 10 GB, concurrencia de hasta 200 por endpoint', 'Sí', 'Modelos chicos en CPU con tráfico esporádico'],
            ['SageMaker Asynchronous Inference', 'Sí (instancias normales, GPU incluidas)', 'Payload de hasta 1 GB y hasta 1 h por request; el input entra por S3 y se encola', 'Sí (0 instancias)', 'Jobs pesados con SLO de minutos'],
            ['SageMaker real-time con inference components', 'Sí', 'Instancias dedicadas', 'Sí, pero volver de cero tarda minutos y mientras tanto las invocaciones fallan', 'Desarrollo, pruebas, tráfico intermitente'],
            ['Google Cloud Run', 'Sí: L4 (24 GB) y RTX PRO 6000 (96 GB), ambas GA; 1 GPU por instancia', 'Regiones limitadas; con L4, mínimo 4 vCPU y 16 GiB; facturación por instancia; la instancia con driver arranca en ≈ 5 s según Google, más tu imagen y tu modelo', 'Sí', 'Inferencia en GPU con tráfico variable'],
            ['Azure Container Apps (GPU serverless)', 'Sí: T4 y A100', '1 GPU por réplica, sin fracciones; cuota y regiones limitadas', 'Sí', 'Lo mismo, en Azure'],
            ['Plataformas de terceros de "serverless GPU"', 'Sí, varias', 'Cambian rápido: verifica cold start, precio, regiones y aislamiento', 'Sí', 'Prototipos y cargas muy esporádicas'],
          ] },
          { t: 'h3', text: 'El modelo de costo, con los números de c01' },
          { t: 'p', html: `c01 recibe en promedio ≈ 116 req/s y de madrugada nunca baja de decenas de req/s. Con tráfico continuo, una instancia serverless nunca se apaga, y "pagar por segundo" se vuelve pagar todos los segundos. Con precios de lista de Cloud Run (us-central1, facturación por instancia):` },
          { t: 'calc', title: 'Una GPU por segundo vs dos T4 siempre encendidas', rows: [
            { label: 'Instancia de Cloud Run con L4', expr: 'GPU 0.0001867 × 3,600 + 4 vCPU × 0.000018 × 3,600 + 16 GiB × 0.000002 × 3,600', value: est('≈ US$1.05/h') },
            { label: 'Horas facturadas en c01', expr: 'el tráfico nunca baja a cero', value: '730 h/mes' },
            { label: 'Una instancia todo el mes', expr: '1.05 × 730', value: est('≈ US$764/mes') },
            { label: 'Con redundancia zonal', expr: '(0.0002909 × 3,600 + 0.37) × 730', value: est('≈ US$1,038/mes'), note: 'para no depender de una sola zona' },
            { label: 'c01 hoy: 2 T4 on-demand', expr: '2 × 0.526 × 730', value: est('≈ US$768/mes') },
            { label: 'La misma L4 dedicada (g6.xlarge)', expr: '0.805 × 730', value: est('≈ US$588/mes'), note: 'Cloud Run cobra ≈ 30 % más por hora de L4' },
          ], result: 'Para c01 el serverless no ahorra: una sola instancia cuesta lo mismo que las dos T4 y no tiene redundancia; con redundancia zonal cuesta ≈ 35 % más, y eso sin contar el gateway. Y el arranque desde cero (instancia, imagen, modelo) no cabe en el timeout de 300 ms del caller: para evitarlo mantienes instancias mínimas calientes y vuelves a pagar las 24 horas.' },
          { t: 'calc', title: 'Cuándo sí gana: una carga esporádica', rows: [
            { label: 'Herramienta interna de moderación', expr: '20,000 imágenes al día, repartidas en ≈ 2 h de uso', value: 'GPU activa ≈ 2 h/día', note: 'supuesto: incluye el rato ocioso antes de apagarse' },
            { label: 'Cloud Run con L4', expr: '2 h × 1.05 × 30 días', value: est('≈ US$63/mes') },
            { label: 'L4 dedicada las 24 h', expr: '0.805 × 730', value: est('≈ US$588/mes') },
            { label: 'Punto de equilibrio', expr: '24 h × 0.805 / 1.05', value: '≈ 18 h de GPU activa al día' },
          ], result: 'Si la GPU trabaja menos de ≈ 18 h al día, pagar por segundo gana, y todavía no contaste el cluster, los nodos y el N+1 que dejas de operar. Por encima gana la instancia dedicada, y con descuentos por compromiso (<a href="#m13">M13</a>) la diferencia crece.' },
          { t: 'table', caption: 'Cuándo gana y cuándo pierde', head: ['Situación', 'Serverless con GPU', 'Por qué'], rows: [
            ['Tráfico esporádico o con valles largos en cero', 'Gana', 'Pagas solo las horas activas'],
            ['Async o batch con SLO de minutos', 'Gana', 'El cold start no importa; la cola lo absorbe'],
            ['Prototipos y muchos modelos chicos poco usados', 'Gana', 'Sin cluster ni nodos que operar'],
            ['Tráfico continuo 24/7 (c01)', 'Pierde', 'Pagas las 730 h con sobreprecio'],
            ['Latencia crítica con ráfagas desde cero', 'Pierde', 'El arranque no cabe en el SLO; con mínimos calientes pagas 24/7'],
            ['Necesitas una GPU concreta (T4 para un engine compilado, MIG, varias GPUs por instancia)', 'Pierde', 'Cada proveedor ofrece pocos tipos y una GPU por instancia'],
          ] },
          { t: 'callout', kind: 'trap', title: '"Con serverless no hay cold start porque escala solo"', html: `<p>Es al revés: escalar solo y desde cero es justo lo que produce cold starts. Lo que los elimina (provisioned concurrency en Lambda, instancias mínimas en Cloud Run) se paga todo el tiempo, y ahí el modelo de costo se parece al de una instancia dedicada.</p>` },
          { t: 'callout', kind: 'senior', html: `<p>Separa las dos variables en voz alta: el <b>perfil de carga</b> (cuántas horas al día trabaja la GPU) decide el costo; el <b>SLO del primer request</b> decide si puedes bajar a cero. c01 falla en las dos. La herramienta interna de moderación pasa las dos.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"Our traffic never drops to zero, so per-second billing means paying for every hour anyway, at a premium, and a cold start from zero wouldn't fit a 300 ms caller timeout. I'd use serverless GPUs for spiky internal tools and async jobs, not for this path."</p>` },
          { t: 'callout', kind: 'connect', html: `<p>La misma pregunta resuelta como follow-up del caso 1: <a href="#c01.seguimiento">c01, preguntas de seguimiento</a>. Precios, descuentos y spot por nube: <a href="#m13">M13</a>.</p>` },
        ],
      },

      // ======================================================== 9
      {
        id: 'alta-disponibilidad',
        title: 'Alta disponibilidad: multi-AZ, PDB y N+1',
        titleEn: 'High availability: multi-AZ, PDBs and N+1',
        priority: 'core',
        dims: ['arquitectura', 'monitoreo'],
        blocks: [
          { t: 'p', html: `99.9 % son ≈ 43 min al mes. La pregunta de diseño es qué dominio de falla aguantas sin gastar ese presupuesto:` },
          { t: 'table', head: ['Falla', 'Frecuencia', 'Qué te protege', 'En c01'], rows: [
            ['Un pod (crash, OOM)', 'Común', 'El kubelet reinicia el contenedor en el mismo pod (<code>restartPolicy: Always</code>); la readiness lo saca del Service mientras vuelve', 'Réplicas ≥ 2 en cada tier'],
            ['Un nodo (la instancia muere o queda NotReady)', 'Ocasional', 'N+1: otra réplica en otro nodo. A los 5 min el pod se desaloja, se recrea y el autoscaler trae otra máquina (flujo "Cae el Triton de 1a", abajo)', 'Dos Triton en dos nodos'],
            ['Una GPU con errores Xid (el nodo sigue Ready)', 'Ocasional', 'Nada automático por defecto: el device plugin marca la GPU como no sana (no entran pods nuevos), pero el contenedor se reinicia sobre la misma GPU rota y el pod queda en CrashLoopBackOff o no listo. Hace falta una alerta sobre <code>DCGM_FI_DEV_XID_ERRORS</code> que haga cordon + drain, o la reparación automática de nodos si la activaste', 'DCGM exporter y esa alerta'],
            ['Una zona (AZ)', 'Rara, pero pasa', 'Réplicas repartidas por zona; un balanceador con presencia en todas', 'Gateway y Triton en 2 AZs'],
            ['Una región', 'Muy rara', 'Multi-región, activo-pasivo o activo-activo', 'No: el fallback manual cubre, y duplicar todo no se justifica para una sugerencia (<a href="#m15">M15</a>)'],
            ['Mantenimiento: drain, upgrade del cluster, consolidación', 'Frecuente y planeado', 'PodDisruptionBudget', '<code>minAvailable: 1</code>'],
          ] },
          { t: 'h3', text: 'N+1 con los números de c01' },
          { t: 'calc', title: 'Por qué dos T4 y no una', rows: [
            { label: 'Capacidad planeada por T4', expr: '50 % de ' + est('≈ 1,200 img/s') + ' medidos', value: '600 img/s' },
            { label: 'GPUs por throughput', expr: 'ceil(500 / 600)', value: '1' },
            { label: 'N+1, una por zona', expr: '1 + 1', value: '2' },
            { label: 'Pico de diseño con las dos', expr: '250 / 1,200', value: '≈ 21 % del máximo por GPU' },
            { label: 'Si cae una zona', expr: '500 / 1,200', value: '≈ 42 % en la T4 que queda' },
            { label: 'CPU del gateway en el pico', expr: '500 × ' + est('≈ 6 ms'), value: '≈ 3 cores', note: 'la zona sana necesita todos: el HPA duplica sus pods' },
          ], result: 'La segunda T4 es por disponibilidad, no por throughput. Y el N+1 es por zona: dos réplicas en el mismo nodo o en la misma AZ no son N+1.' },
          { t: 'p', html: `La regla de spread de c01 (<code>maxSkew: 1</code>, <code>whenUnsatisfiable: DoNotSchedule</code>) obliga a poner una réplica por zona y prefiere un pod Pending a dos GPUs en la misma AZ. Tiene un costo que el manifest de c01 documenta: con la política por defecto para taints (<code>nodeTaintsPolicy: Ignore</code>), durante la caída de una zona sus nodos NotReady siguen contando como un dominio con 0 pods, así que la zona sana no puede pasar de una réplica y KEDA no escala mientras dure. Se acepta porque una T4 aguanta el pico al ≈ 42 %. Cambiarlo a <code>Honor</code> lo evita, pero un taint pasajero (un nodo que arranca o se drena) podría dejar las dos GPUs en la misma zona. Ese tipo de interacción se prueba en un game day, no se adivina.` },
          { t: 'h3', text: 'PodDisruptionBudget: qué protege y qué no' },
          { t: 'table', head: ['Disrupción', 'Tipo', '¿La frena el PDB?'], rows: [
            ['<code>kubectl drain</code>, upgrade de nodos, consolidación de Karpenter', 'Voluntaria, por la Eviction API', 'Sí'],
            ['El rolling update de tu Deployment', 'Voluntaria, pero no usa la Eviction API', 'No: la controla <code>maxUnavailable</code>'],
            ['Borrar un pod o el Deployment a mano', 'Voluntaria', 'No'],
            ['Muere el nodo, cae la zona, el nodo se queda sin memoria', 'Involuntaria', 'No: eso lo cubre el N+1'],
            ['Interrupción de spot', 'Involuntaria (2 min de aviso en AWS)', 'No: Karpenter drena el nodo durante el aviso, pero al vencer la instancia se va igual'],
          ] },
          { t: 'callout', kind: 'trap', title: 'El PDB que bloquea el cluster', html: `<p><code>minAvailable</code> igual al número de réplicas (o <code>maxUnavailable: 0</code>) prohíbe toda evicción voluntaria: ningún drain termina y los upgrades del cluster se quedan trabados. Con 2 réplicas, <code>minAvailable: 1</code>. Y un pod en CrashLoopBackOff protegido por un PDB también puede trabar un drain con la política por defecto (<code>IfHealthyBudget</code>); <code>unhealthyPodEvictionPolicy: AlwaysAllow</code> deja desalojar los pods que no están sanos.</p>` },
          { t: 'h3', text: 'Apagado ordenado' },
          { t: 'steps', items: [
            { title: 'El pod pasa a Terminating', meta: 't = 0', html: `<p>Al mismo tiempo, su endpoint se marca como no listo y kube-proxy y el controlador del ALB dejan de mandarle requests nuevos. Esa propagación tarda unos segundos: durante ese rato todavía llegan requests.</p>` },
            { title: 'Corre el preStop', meta: 'c01: 10 s en Triton, 15 s en el gateway', html: `<p>Un <code>sleep</code> que mantiene el proceso sirviendo lo que siga llegando mientras la baja se propaga. En el gateway es más largo porque el ALB tarda más que kube-proxy en desregistrar un target.</p>` },
            { title: 'SIGTERM', meta: 'Triton 30 s · uvicorn 20 s', html: `<p>El proceso deja de aceptar y termina lo que tiene en vuelo: <code>--exit-timeout-secs=30</code> en Triton, <code>--timeout-graceful-shutdown 20</code> en uvicorn.</p>` },
            { title: 'SIGKILL si se pasa', meta: 'grace period: 60 s y 45 s en c01; 30 s por defecto', html: `<p>El tiempo del preStop cuenta dentro de <code>terminationGracePeriodSeconds</code>. Si preStop + drenado no caben, el kubelet mata el proceso con requests a medias: por eso c01 lo dimensiona como preStop + drenado + margen.</p>` },
          ] },
          { t: 'code', title: 'Spread por zona, preStop y PDB de Triton', caption: 'Del manifest de c01, con los comentarios resumidos. Validado con kubernetes-validate --strict (1.34 y 1.36).', files: [
            { name: 'triton-ha.yaml', lang: 'yaml', code: HA },
          ] },
          { t: 'h3', text: 'Ruteo por zona y el costo de cruzar' },
          { t: 'p', html: `Cada request manda un tensor de 602 KB del gateway a Triton. Si el Service repartiera al azar entre zonas, la mitad cruzaría de AZ: ≈ 90 TB al mes a ${est('US$0.02/GB')} (US$0.01 en cada sentido), ${est('≈ US$1,800/mes')}, más que las dos GPUs (<a href="#c01.estimaciones">estimaciones de c01</a>). <code>trafficDistribution: PreferSameZone</code> hace que cada gateway prefiera el Triton de su zona (Kubernetes ≥ 1.34, estable en 1.35; antes existía como <code>PreferClose</code>). Si en su zona no hay un Triton listo, el tráfico va a la otra: degrada, no se cae. Funciona solo si los gateways también están repartidos parejo entre zonas.` },
          { t: 'callout', kind: 'trap', title: 'El tercer Triton solo alivia una zona', html: `<p>Con ruteo por zona, la capacidad se agrega por zona. KEDA sube de 2 a 3 réplicas y el spread pone la tercera en una de las dos zonas, digamos 1a: con los gateways parejos, la T4 de 1b sigue recibiendo el 50 % del tráfico, así que el tercer pod baja la carga de 1a y no cambia nada en 1b. Mientras 1b siga saturada, el promedio que lee KEDA sigue arriba del objetivo y termina pidiendo el 4.º pod, que el spread manda a 1b, pero eso es otro cold start de GPU. La salida limpia, que la misma documentación de Kubernetes sugiere para este caso, es un Deployment y un ScaledObject por zona, cada uno escalado por la cola de su zona.</p>` },
          { t: 'diagram', id: 'ha-dos-zonas', title: 'c01 en dos zonas: qué pasa cuando falla una pieza', caption: 'Azul: el camino del request. Punteado: el desvío entre zonas, que solo se usa si una zona se queda sin Triton. Recorre los tres flujos.', spec: ZONAS },
          { t: 'callout', kind: 'interview', html: `<p>"Each tier runs at least one replica per zone, with a topology spread constraint. If a zone goes down, the remaining T4 carries the whole design peak at about 42% of its measured max, and the gateways in the healthy zone scale up on CPU. The PDB only protects us from voluntary disruptions like node drains; node or zone failures are what the N+1 is for."</p>` },
          { t: 'followups', items: [
            { q: 'El HPA no escala aunque la latencia se disparó. ¿Por qué?',
              junior: 'Porque el umbral de CPU está muy alto. Lo bajo a 30 %.',
              senior: 'Primero miro qué ve el HPA (<code>kubectl describe hpa</code>): la métrica actual, el objetivo y las condiciones. Si escala por CPU un pod de GPU, ahí está: la CPU sigue al throughput completado y se congela cuando la GPU se satura, así que nunca cruza el objetivo. Otras causas: ya está en <code>maxReplicas</code>; la métrica no llega (Metrics Server o el adaptador caídos: aparece como &lt;unknown&gt;); los pods no tienen request de CPU y no hay contra qué medir; las réplicas nuevas están Pending sin nodo GPU; o la variación cae dentro de la tolerancia de 10 %. El arreglo de fondo es escalar Triton por tiempo en cola o requests en espera, y alertar sobre pods Pending y sobre un autoscaler en su máximo.',
              why: 'Diagnostica con lo que el HPA ve y explica por qué la CPU no sirve en un tier de GPU. Bajar el umbral solo cambia una métrica proxy por otra.' },
            { q: '¿Escalarías tu servicio de GPU a cero de noche?',
              junior: 'Sí, así ahorramos la mitad de las GPUs.',
              senior: 'En c01, no, y ni siquiera podría: de madrugada el tráfico no baja de decenas de req/s, así que siempre hace falta una GPU encendida. Si la apagara por horario, cada request de la madrugada caería al selector manual, y al volver pagaría minutos de cold start (nodo, imagen de varios GB, engine) contra un timeout de 300 ms. Me quedo con el mínimo de 2 por N+1, un Savings Plan sobre esa base y KEDA para la curva del día. Lo que sí baja a cero son los workers asíncronos, como el backfill o una cola de OCR, cuyo SLO se mide en minutos.',
              why: 'Contrasta el perfil de tráfico y el SLO del primer request con el cold start, y ofrece la palanca de costo que sí aplica.' },
            { q: '¿Qué pasa en tu diseño si se cae una zona?',
              junior: 'Kubernetes mueve los pods a la otra zona y listo.',
              senior: 'El ALB deja de mandar tráfico a los targets de esa zona en cuanto fallan sus health checks. La T4 de la zona sana queda al ≈ 42 % de su máximo medido en el pico de diseño: aguanta. Los gateways de la zona sana pasan a necesitar ≈ 3 cores, así que el HPA duplica sus pods y Karpenter agrega nodos de CPU en esa zona; mientras llegan, el load shedding protege la latencia. Mientras dura la caída no tengo N+1: otra falla cae al fallback manual. Y un detalle del manifest: con DoNotSchedule, la zona caída sigue contando en el spread y KEDA no puede poner un segundo Triton en la zona sana. Lo acepto porque una T4 alcanza, y lo pruebo en un game day.',
              why: 'Recorre cada tier con números, dice qué redundancia se pierde durante la falla y conoce una interacción no obvia de su propia configuración.' },
            { q: 'Un deploy de Triton lleva 20 minutos con un pod Pending. ¿Qué pasó?',
              junior: 'Kubernetes está lento. Hago <code>rollout restart</code>.',
              senior: 'Con <code>maxSurge: 1</code> y <code>maxUnavailable: 0</code>, el pod nuevo necesita una T4 libre antes de que se vaya uno viejo. Miro los eventos del pod (Insufficient nvidia.com/gpu) y los de Karpenter: ¿intentó lanzar un nodo? ¿EC2 respondió sin capacidad en esa zona, se agotó la cuota de vCPUs de instancias G o el NodePool llegó a su límite? A los 10 min el Deployment marcó <code>ProgressDeadlineExceeded</code>, pero no revierte solo; los pods viejos siguen sirviendo, así que el usuario no nota nada. Arreglo: permitir otro tamaño de T4 y otra zona, subir la cuota o el límite del pool, o mantener un nodo de reserva si los deploys son frecuentes. Un restart solo crearía otro pod igual de Pending.',
              why: 'Conecta la estrategia de rollout con la escasez de GPUs y revisa cada eslabón (scheduler, autoscaler, nube, cuota) antes de tocar nada.' },
            { q: 'Marketing anuncia un Hot Sale: 5× el pico diario durante 2 horas. ¿Qué haces?',
              junior: 'Nada: tenemos autoscaling.',
              senior: 'No le dejo un evento conocido al autoscaler. 5 × 350 = 1,750 req/s: ceil(1,750 / 600) = 3 T4 por throughput, más 1 de N+1 = 4, justo el máximo actual de KEDA, que subo para tener margen; si además quiero aguantar la caída de una zona en pleno evento, necesito 3 por zona: 6. Eso choca con el límite del NodePool de T4 (<code>nvidia.com/gpu: 6</code>, que ya contaba surge y reserva): lo subo a 8 (6 réplicas + 1 de surge + 1 de reserva) y pido cuota para 8 × 4 = 32 vCPU de instancias G. El gateway necesita ≈ 10.5 cores (1,750 × 6 ms), ≈ 18 pods al 60 %, más que el máximo de 12 de su HPA; también lo subo. La red entre tiers pasa a ≈ 8 Gb/s en FP32 (<a href="#m03.trafico">M3</a>): reviso nodos de gateway más grandes. El día anterior subo los mínimos, confirmo cuota y capacidad en ambas zonas, precargo imágenes y corro un load test a esa tasa. Lo que exceda eso lo cubren el load shedding y el fallback.',
              why: 'Convierte el evento en números por tier, encuentra los techos de su propia configuración y prepara la capacidad antes, en vez de confiar en un autoscaler que tarda minutos.' },
          ] },
        ],
      },

      // ======================================================== 10
      {
        id: 'autoevaluacion',
        title: 'Autoevaluación',
        titleEn: 'Self-check',
        priority: 'core',
        dims: ['arquitectura'],
        blocks: [
          { t: 'p', html: `Responde sin mirar. Si fallas más de dos, vuelve a la sección de la explicación y repasa en voz alta el autoscaling del <a href="#c01.serving">caso 1</a>.` },
          { t: 'quiz', items: [
            { q: 'Un Deployment tiene 4 pods al 90 % de su request de CPU y un HPA con objetivo de 60 %. ¿Cuántas réplicas pide?', options: ['5', '6', '8', '4'], answer: 1,
              explain: 'ceil(4 × 90 / 60) = ceil(6) = 6. Ratio 1.5: muy fuera de la tolerancia de 10 %.' },
            { q: 'Un pod de Triton sirve con la GPU saturada y rechaza requests, pero su CPU está en 30 % del request. ¿Por qué no escala un HPA por CPU al 60 %?', options: ['Porque el HPA tarda 5 min en reaccionar', 'Porque la CPU sigue al throughput completado, que se aplana cuando la GPU se satura: nunca llega al objetivo', 'Porque los pods de GPU no tienen métricas de CPU', 'Porque la tolerancia de 10 % lo impide'], answer: 1,
              explain: 'La CPU de Triton es proporcional a los requests que termina. Cuando la GPU se satura, el throughput deja de crecer y la CPU también, justo cuando la cola explota. Escala por tiempo en cola o requests en espera.' },
            { q: 'Un pod declara solo <code>nvidia.com/gpu: 1</code> en limits, sin CPU ni memoria. ¿Qué clase de QoS tiene?', options: ['Guaranteed', 'Burstable', 'BestEffort', 'Ninguna: los pods de GPU no tienen QoS'], answer: 2,
              explain: 'Los recursos extendidos no cuentan para la QoS. Sin requests ni limits de CPU y memoria, es BestEffort: primero en ser desalojado y sin base para un HPA por CPU.' },
            { q: '¿En qué probe del gateway va la comprobación de que Triton está listo?', options: ['Liveness', 'Readiness', 'Startup', 'En ninguna: en un sidecar'], answer: 1,
              explain: 'Si falla la readiness, el pod sale del balanceo sin reiniciarse. En la liveness, una caída de Triton reiniciaría en cascada gateways sanos que no arreglan nada.' },
            { q: 'Un Deployment con 2 réplicas usa los valores por defecto del rolling update. ¿Cuántos pods puede haber de más y de menos durante el deploy?', options: ['1 de más, 0 de menos', '1 de más, 1 de menos', '0 de más, 1 de menos', '2 de más, 0 de menos'], answer: 0,
              explain: '25 % de 2 = 0.5: maxSurge redondea hacia arriba (1) y maxUnavailable hacia abajo (0). En un tier de GPU, ese pod de más necesita una GPU libre.' },
            { q: 'Escribes un ScaledObject de KEDA para un servicio online y no declaras <code>minReplicaCount</code>. ¿Qué pasa de madrugada?', options: ['Se queda en 1 réplica', 'Baja a cero: el default es 0, y el primer request paga el cold start', 'KEDA rechaza el objeto', 'Se queda en las réplicas del Deployment'], answer: 1,
              explain: 'El default de minReplicaCount es 0. Para un servicio online, escríbelo siempre.' },
            { q: 'Tu PDB de Triton dice <code>minAvailable: 1</code> y tienes 2 réplicas en 2 nodos. ¿De qué te protege?', options: ['De la muerte de un nodo', 'De la caída de una zona', 'De que un drain o un upgrade del cluster saque las dos réplicas a la vez', 'De un rolling update mal configurado'], answer: 2,
              explain: 'El PDB solo limita evicciones voluntarias por la Eviction API. La muerte de un nodo o de una zona es involuntaria (eso lo cubre el N+1), y los rolling updates los controla maxUnavailable.' },
            { q: 'Un servicio recibe tráfico continuo, 24/7, sin valles en cero. ¿Cuántas horas al mes factura una instancia de GPU serverless con facturación por instancia?', options: ['Solo las horas con requests: ≈ 50 %', '≈ 730: nunca se apaga', 'Depende del número de requests, no del tiempo', '≈ 365: la mitad, por los valles nocturnos'], answer: 1,
              explain: 'Con tráfico continuo la instancia nunca baja a cero: pagas las ≈ 730 h del mes, con el sobreprecio por hora del serverless.' },
            { q: 'KEDA con el trigger de SQS, <code>queueLength: 15</code>, y la cola tiene 90 mensajes entre visibles y en proceso. ¿Cuántos workers pide?', options: ['15', '90', '6', '1'], answer: 2,
              explain: 'AverageValue: ceil(90 / 15) = 6. queueLength es el objetivo de mensajes por réplica.' },
          ] },
          { t: 'checklist', id: 'antes-de-escalar', items: [
            { id: 'plataforma', html: 'Justifico Kubernetes vs endpoint gestionado vs una VM por quién lo opera, cuántos modelos hay y qué GPU necesito.' },
            { id: 'requests', html: 'Pongo request de CPU y memoria en todos los pods (también en los de GPU), límite de memoria = request y ningún límite de CPU en los pods sensibles a latencia.' },
            { id: 'probes', html: 'Separo startup (carga del modelo), readiness (modelo listo) y liveness (solo el proceso, nunca una dependencia).' },
            { id: 'rollout', html: 'Sé cuántas GPUs extra pide mi rolling update y de dónde salen (maxSurge, nodo de reserva o maxUnavailable).' },
            { id: 'aislamiento', html: 'Aíslo los nodos GPU con taint + toleration y fijo el tipo de GPU con nodeSelector, porque el engine está atado a la arquitectura.' },
            { id: 'senal', html: 'Escalo cada tier con la señal del recurso que se satura primero: CPU en el gateway, tiempo en cola o requests en espera en el model server.' },
            { id: 'utilizacion', html: 'Explico por qué la utilización de nvidia-smi no mide capacidad ni cola.' },
            { id: 'cero', html: 'Decido si un tier puede bajar a cero según el SLO de su primer request, y escribo minReplicaCount explícito.' },
            { id: 'nodos', html: 'Recuerdo que los pods no escalan más allá de los nodos: tipos y zonas alternativos, cuota pedida, alertas de pods Pending.' },
            { id: 'reparto', html: 'Compruebo que la réplica nueva recibe tráfico: con ruteo por zona la capacidad se agrega por zona, y las conexiones gRPC o keep-alive tienen que rebalancearse.' },
            { id: 'cold-start', html: 'Desgloso el cold start de un nodo GPU (detección, nodo, imagen, modelo, readiness) y digo qué palanca acorta cada tramo.' },
            { id: 'programado', html: 'Para los picos conocidos escalo antes (cron, mínimos más altos) y dejo el load shedding para lo desconocido.' },
            { id: 'ha', html: 'Hago la cuenta del N+1 por zona, sé qué protege un PDB y qué no, y dimensiono el apagado ordenado (preStop + drenado ≤ grace period).' },
          ] },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'm06-01', kind: 'concepto', q: '¿Qué cinco cosas te da un orquestador como Kubernetes?',
        a: 'Scheduling (qué nodo cumple las reglas de CPU, memoria, GPU y zona), self-healing (reiniciar y recrear), rollouts (versión nueva de a poco, y vuelta atrás), service discovery y balanceo (nombre DNS estable) y autoscaling de pods y de nodos. Todo con el mismo mecanismo: comparar el estado deseado con el real y corregir.' },
      { id: 'm06-02', kind: 'tradeoff', q: 'Kubernetes (EKS) vs endpoint gestionado (SageMaker) para servir un modelo.',
        a: 'EKS: control total y reutiliza la plataforma de la empresa, a cambio de operar node groups, drivers y autoscaling. SageMaker: autoscaling, canary y métricas sin operar nodos, a cambio de sobreprecio por instancia y menos control. Decide quién lo opera: sin equipo de plataforma y con pocos modelos, el endpoint gestionado.' },
      { id: 'm06-03', kind: 'concepto', q: 'Request vs limit, para CPU y para memoria.',
        a: 'El request reserva capacidad para agendar el pod y es la base del % del HPA. El limit es el techo: en CPU, pasarse produce throttling (el contenedor se congela el resto de la ventana de 100 ms); en memoria, OOMKilled (exit code 137). La GPU va en limits, en enteros, y no se sobreasigna.' },
      { id: 'm06-04', kind: 'trampa', q: '¿Por qué c01 no pone límite de CPU en el gateway?',
        a: 'Por el throttling de CFS: con limit de 1 CPU, 4 decodes de 40 ms en paralelo agotan la cuota a los 25 ms, el pod queda congelado hasta el ms 100 y cada foto tarda 115 ms en vez de 40, aunque el uso promedio se vea bajo. El request ya garantiza su parte; la memoria sí se limita, igual al request.' },
      { id: 'm06-05', kind: 'concepto', q: 'Las tres clases de QoS y quién sale primero si el nodo se queda sin memoria.',
        a: 'Guaranteed: request = limit de CPU y memoria en cada contenedor (los últimos en salir). Burstable: algún request o limit sin llegar a Guaranteed. BestEffort: nada de CPU ni memoria (los primeros). Los dos tiers de c01 son Burstable.' },
      { id: 'm06-06', kind: 'trampa', q: 'Un pod declara solo nvidia.com/gpu: 1. ¿Qué problema tiene?',
        a: 'Es BestEffort: los recursos extendidos no cuentan para la QoS. No reserva CPU ni memoria, puede caer donde la CPU ya está tomada, sale primero ante presión de memoria y un HPA por CPU no puede calcular su utilización. Declara siempre CPU y memoria.' },
      { id: 'm06-07', kind: 'concepto', q: 'Startup, readiness y liveness en un model server.',
        a: 'Startup: cubre la carga de pesos y el warmup (c01: 60 × 5 s = 5 min); mientras no pasa, las otras no corren. Readiness: solo con el modelo cargado; si falla, el pod sale del Service. Liveness: solo el proceso, nunca una dependencia; si falla, reinicia. Defaults: period 10 s, timeout 1 s, failureThreshold 3.' },
      { id: 'm06-08', kind: 'numero', q: 'Valores por defecto del rolling update y qué dan con 2 y con 8 réplicas.',
        a: 'maxSurge 25 % (redondea hacia arriba) y maxUnavailable 25 % (hacia abajo). 2 réplicas: +1 y −0. 8 réplicas: +2 y −2. En GPU, cada pod de más es una GPU de más; si no llega, el deploy queda Pending y a los 600 s marca ProgressDeadlineExceeded, sin revertir solo.' },
      { id: 'm06-09', kind: 'concepto', q: '¿Qué tiene que existir para que un pod reciba una GPU en Kubernetes?',
        a: 'Driver de NVIDIA en el nodo (AMI o GPU Operator), NVIDIA Container Toolkit en el runtime, el device plugin anunciando nvidia.com/gpu, y el pod pidiendo nvidia.com/gpu en limits. La AMI acelerada de EKS (AL2023) trae driver y toolkit, no el device plugin.' },
      { id: 'm06-10', kind: 'concepto', q: 'nodeSelector y taint en los nodos GPU: ¿por qué los dos?',
        a: 'El taint aleja a los pods de CPU de las máquinas caras. El nodeSelector lleva a Triton a la GPU exacta para la que se compiló el engine (T4, sm_75). Sin taint, el gateway ocupa las g4dn; sin nodeSelector, Triton podría caer en otra GPU donde su engine no carga.' },
      { id: 'm06-11', kind: 'numero', q: 'Fórmula del HPA y cómo sube y baja.',
        a: 'ceil(actuales × métrica / objetivo); con varias métricas, el máximo. Sube rápido (sin ventana) y baja despacio (ventana de estabilización, 5 min por defecto) para no oscilar. Ejemplo: 5 pods al 90 % con objetivo 60 % → 8.' },
      { id: 'm06-12', kind: 'trampa', q: '¿Por qué un HPA por CPU no escala un Triton saturado?',
        a: 'La CPU de Triton sigue al throughput completado, y el throughput se aplana cuando la GPU se satura. Un pod al máximo (≈ 1,210 img/s) queda en ≈ 30 % de CPU mientras rechaza hasta 1 de cada 4 requests: ceil(1 × 30 / 60) = 1, no escala. Bajar el umbral lo vuelve una métrica proxy de throughput.' },
      { id: 'm06-13', kind: 'trampa', q: 'nvidia-smi marca 100 %. ¿La GPU está llena?',
        a: 'No necesariamente. Mide la fracción del tiempo con algún kernel corriendo: con batch 1 marca 30–40 % aunque la GPU haría varias veces más con batches, y una vez ocupada marca ≈ 100 % igual con 2 que con 200 requests en cola. Sirve para dashboards; para escalar, tiempo en cola o requests en espera.' },
      { id: 'm06-14', kind: 'concepto', q: 'Señales para escalar un model server en GPU, de mejor a peor.',
        a: 'Tiempo en cola (el síntoma del SLO; Value, proporcional), requests en espera o en vuelo por réplica (AverageValue, objetivo con Little), QPS por réplica contra la capacidad planeada (estable, pero hay que recalibrarlo). Utilización de GPU y CPU del pod: engañosas.' },
      { id: 'm06-15', kind: 'concepto', q: '¿Cómo llega una métrica de Prometheus a un HPA?',
        a: 'El HPA lee metrics.k8s.io (CPU y memoria, Metrics Server), custom.metrics.k8s.io y external.metrics.k8s.io. Prometheus Adapter publica métricas custom; KEDA publica external. Solo cabe un servidor de métricas external por cluster.' },
      { id: 'm06-16', kind: 'concepto', q: 'KEDA: ¿quién escala qué, y ScaledObject vs ScaledJob?',
        a: 'KEDA crea y alimenta un HPA (keda-hpa-&lt;nombre&gt;). KEDA decide 0 ↔ 1 (activación); el HPA, 1 ↔ N. ScaledObject escala un Deployment (al bajar puede matar un pod a mitad de un mensaje); ScaledJob crea Jobs que terminan su trabajo (jobs largos, pero cargan el modelo cada vez).' },
      { id: 'm06-17', kind: 'numero', q: 'Workers GPU con KEDA sobre SQS: aceptas 300 s de espera, ≈ 20 s por job y hay 120 mensajes. ¿queueLength y cuántos workers?',
        a: 'queueLength = 300 / 20 = 15 mensajes por worker; ceil(120 / 15) = 8 workers. El trigger de SQS cuenta visibles + en proceso y no tiene modo de edad del mensaje: la edad es tu alerta.' },
      { id: 'm06-18', kind: 'trampa', q: 'Dos defaults de KEDA que te muerden en producción.',
        a: 'minReplicaCount = 0: un servicio online sin ese campo baja a cero de madrugada. ignoreNullValues = true en el trigger de Prometheus: si la query vuelve vacía (no hay scrape), la toma como 0 y el servicio no escala sin que nada avise. c01 lo pone en "false".' },
      { id: 'm06-19', kind: 'tradeoff', q: 'Escalar a cero: ¿cuándo sí y cuándo no?',
        a: 'Sí: workers asíncronos con SLO de minutos, backfills, herramientas poco usadas que toleran esperar. No: servicios síncronos con p99 de ms y tráfico continuo (c01): el primer request pagaría minutos de cold start (nodo, imagen, modelo) contra un timeout de 300 ms.' },
      { id: 'm06-20', kind: 'tradeoff', q: 'Cluster Autoscaler vs Karpenter.',
        a: 'CA agranda node groups (ASGs) de máquinas iguales; multi-nube; baja nodos subutilizados tras 10 min. Karpenter elige y lanza instancias sueltas según los pods pendientes (sin ASG), prueba otra combinación si falta capacidad y consolida. Los dos reaccionan a pods Pending y con GPUs tardan minutos.' },
      { id: 'm06-21', kind: 'concepto', q: 'Overprovisioning: cómo funciona y cuánto cuesta en c01.',
        a: 'Un pod placeholder de prioridad −10 (la más baja que todavía hace escalar al Cluster Autoscaler) ocupa un nodo GPU. Un pod real lo desaloja y arranca sin esperar el nodo; el placeholder dispara el próximo nodo en segundo plano. Cuesta una T4 on-demand: ≈ US$384/mes.' },
      { id: 'm06-22', kind: 'numero', q: 'Desglose del cold start de un scale-out de Triton sin nodo libre.',
        a: 'Detectar ≈ 0.5–1.5 min, nodo GPU nuevo ≈ 2–5 min, imagen de ≈ 9 GB ≈ 2–5 min, cargar engine y warmup ≈ 10–60 s, readiness ≈ 5–15 s: ≈ 5–13 min en total (estimaciones: mide las tuyas). Por eso headroom para spikes y escalado programado para picos conocidos.' },
      { id: 'm06-23', kind: 'numero', q: 'Serverless GPU vs dedicada: ¿cuándo conviene pagar por segundo?',
        a: 'Cloud Run con L4 ≈ US$1.05/h contra una L4 dedicada ≈ US$0.805/h: gana si la GPU trabaja menos de ≈ 18 h al día. c01 (116 req/s continuos) factura las 730 h: ≈ US$764/mes una instancia, ≈ US$1,038 con redundancia zonal, contra ≈ US$768 de sus dos T4.' },
      { id: 'm06-24', kind: 'concepto', q: '¿De qué te protege un PodDisruptionBudget y de qué no?',
        a: 'Sí: evicciones voluntarias por la Eviction API (drain, upgrades de nodos, consolidación). No: rolling updates (los controla maxUnavailable), borrar pods a mano, muerte de un nodo o de una zona (eso es N+1). minAvailable igual a las réplicas bloquea todos los drains.' },
      { id: 'm06-25', kind: 'numero', q: 'N+1 en c01: carga por GPU normal y con una zona caída.',
        a: 'Capacidad planeada 600 img/s por T4 → 1 GPU por throughput, 2 por N+1 (una por zona). Con las dos: 250 / 1,200 ≈ 21 % del máximo en el pico de diseño. Con una zona caída: 500 / 1,200 ≈ 42 %. El gateway de la zona sana necesita ≈ 3 cores.' },
      { id: 'm06-26', kind: 'concepto', q: 'Secuencia del apagado ordenado de un pod.',
        a: 'Terminating y fuera de los endpoints (tarda unos segundos en propagarse) → preStop (c01: sleep 10 s en Triton, 15 s en el gateway) → SIGTERM y drenado (Triton 30 s, uvicorn 20 s) → SIGKILL al vencer terminationGracePeriodSeconds (c01: 60 y 45 s; default 30 s). El preStop cuenta dentro del grace period.' },
      { id: 'm06-27', kind: 'frase', q: '¿Cómo explicas en inglés por qué no escalas Triton por CPU?',
        a: '"Triton\'s CPU tracks completed requests, so it flattens exactly when the GPU saturates. I scale on queue time instead, which is the symptom the SLO cares about."' },
      { id: 'm06-28', kind: 'frase', q: '¿Cómo justificas en inglés el headroom frente al autoscaling de GPUs?',
        a: '"A GPU scale-out takes several minutes end to end, so autoscaling follows the daily curve, while headroom and load shedding absorb spikes that last seconds."' },
    ],

    // ---------------------------------------------------------- glosario
    // Términos nuevos de este módulo. HPA, KEDA, cold start, liveness/readiness probe,
    // PodDisruptionBudget, taint and toleration, node group, N+1 redundancy, availability
    // zone (AZ), trafficDistribution, spot instance y GPU time-slicing ya los definen
    // módulos anteriores: no se repiten.
    glossary: [
      { en: 'control plane', es: 'plano de control', def: 'Los componentes que guardan el estado deseado del cluster y lo hacen cumplir: API server, scheduler, controladores y etcd. En EKS, GKE o AKS lo opera el proveedor.', say: 'The control plane is managed by EKS, so we only operate the node groups.' },
      { en: 'Pod', es: 'pod', def: 'La unidad que Kubernetes agenda: uno o más contenedores que comparten red y volúmenes en un mismo nodo. Es efímero: se recrea, no se repara.', say: 'Each Triton pod gets one whole T4.' },
      { en: 'Deployment', es: 'Deployment', def: 'Objeto que mantiene N réplicas idénticas de un pod y cambia de versión con rolling updates. El estándar para serving sin estado.', say: 'Triton runs as a Deployment whose replica count is owned by the autoscaler.' },
      { en: 'Kubernetes Service', es: 'Service (Kubernetes)', def: 'Nombre DNS e IP estables delante de los pods listos que cumplen un selector. Balancea por conexión (L4).', say: 'The gateway reaches Triton through a ClusterIP Service, never by pod IP.' },
      { en: 'kubelet', es: 'agente del nodo', def: 'Proceso de Kubernetes en cada nodo: baja las imágenes, arranca los contenedores del pod, corre las probes y los reinicia. El scheduler decide a qué nodo va el pod; el kubelet lo ejecuta.', say: 'The kubelet restarts the container when liveness fails; readiness only takes the pod out of the Service.' },
      { en: 'DaemonSet', es: 'DaemonSet', def: 'Objeto que corre una copia de un pod en cada nodo, o en cada nodo que cumpla un selector: el device plugin de NVIDIA, el DCGM exporter, los agentes de logs, la pre-descarga de imágenes.', say: 'The NVIDIA device plugin runs as a DaemonSet on every GPU node.' },
      { en: 'GitOps', es: 'GitOps', def: 'Los manifests viven en git y una herramienta (Argo CD, Flux) sincroniza el cluster con ese repo. Un cambio o un rollback es un commit o un revert revisado, no un <code>kubectl</code> a mano.', say: 'With GitOps, a rollback is a git revert that Argo CD syncs to the cluster.' },
      { en: 'IRSA', es: 'roles de IAM para service accounts', def: 'En EKS, el pod recibe credenciales temporales de un rol de IAM a través de su ServiceAccount, sin llaves guardadas en Secrets. EKS Pod Identity es la alternativa más nueva.', say: 'The KEDA operator reads SQS through an IAM role for its service account, so there are no static keys in the cluster.' },
      { en: 'requests and limits', es: 'requests y limits', def: 'El request reserva CPU o memoria para agendar el pod (y es la base del % del HPA); el limit es el techo. Pasarse del limit de CPU produce throttling; del de memoria, OOMKilled.', say: 'We set CPU requests but no CPU limits on the serving pods, and memory limits equal to requests.' },
      { en: 'CPU throttling', es: 'estrangulamiento de CPU', def: 'Cuando un contenedor con límite de CPU agota su cuota de la ventana de 100 ms (CFS), el kernel lo congela hasta la ventana siguiente. Se ve como picos de latencia con CPU promedio baja.', say: 'A one-core CPU limit shows up as p99 spikes from CFS throttling even when average CPU looks low, so the serving pods get CPU requests and no CPU limits.' },
      { en: 'OOMKilled', es: 'OOMKilled (matado por falta de memoria)', def: 'Estado de un contenedor que el kernel mató por pasar su límite de memoria RAM (exit code 137). El kubelet lo reinicia. Es RAM del contenedor, no VRAM: quedarse sin memoria de GPU es un error de CUDA dentro del proceso, no un OOMKilled.', say: 'A few 40-megapixel PNGs decoding at once could get the gateway OOMKilled, so it rejects anything above 40 megapixels and caps concurrent decodes per pod.' },
      { en: 'QoS class', es: 'clase de QoS', def: 'Guaranteed, Burstable o BestEffort, según los requests y limits de CPU y memoria. Decide el orden de desalojo cuando falta memoria en el nodo. Los recursos extendidos, como la GPU, no cuentan.', say: 'A pod that only requests a GPU is BestEffort, so it\'s the first to be evicted.' },
      { en: 'startup probe', es: 'probe de arranque', def: 'Probe que protege a un contenedor de arranque lento: mientras no pasa, no corren liveness ni readiness. Se dimensiona con failureThreshold × periodSeconds.', say: 'Triton gets a startup probe with a five-minute budget for loading and warming up the engine.' },
      { en: 'rolling update', es: 'actualización gradual', def: 'Reemplazo de pods de a poco, controlado por maxSurge (pods de más) y maxUnavailable (pods de menos), ambos 25 % por defecto.', say: 'With maxSurge one, a rolling update needs a spare GPU for a few minutes.' },
      { en: 'device plugin', es: 'plugin de dispositivos', def: 'DaemonSet del fabricante que detecta dispositivos (GPUs) en cada nodo y los anuncia al kubelet como recurso extendido, como nvidia.com/gpu.', say: 'Without the NVIDIA device plugin, the node advertises no GPUs and nothing gets scheduled there.' },
      { en: 'extended resource', es: 'recurso extendido', def: 'Recurso que Kubernetes no conoce de fábrica y que se anuncia por nodo (nvidia.com/gpu). Solo enteros, en limits, sin sobreasignación.', say: 'GPUs are an extended resource, so a pod can\'t ask for half of one without MIG or time-slicing.' },
      { en: 'NVIDIA GPU Operator', es: 'NVIDIA GPU Operator', def: 'Operador que instala y gestiona en Kubernetes el driver, el Container Toolkit, el device plugin, GPU Feature Discovery, el DCGM exporter y el MIG manager.', say: 'On-prem I\'d use the GPU Operator; on EKS the AMI already ships the driver, so that part stays disabled.' },
      { en: 'DCGM exporter', es: 'exportador DCGM', def: 'Exportador de NVIDIA que publica en Prometheus métricas por GPU: utilización, memoria, temperatura, potencia y errores Xid.', say: 'We watch Xid errors from the DCGM exporter to drain nodes with failing GPUs.' },
      { en: 'nodeSelector', es: 'selector de nodos', def: 'Campo del pod que exige nodos con ciertas labels. Atrae al pod; el taint, en cambio, aleja a los demás.', say: 'A node selector pins Triton to the T4 pool because the engine is built for that architecture.' },
      { en: 'node pool', es: 'pool de nodos', def: 'Grupo de nodos con la misma configuración (tipo de instancia, labels, taints) que escala como unidad. GKE y AKS lo llaman node pool y EKS, node group; en Karpenter, un NodePool declara requisitos (GPU, zonas, on-demand o spot) en vez de un tipo fijo.', say: 'Triton gets its own T4 node pool with a NoSchedule taint, so CPU pods never land on a GPU node.' },
      { en: 'bin packing', es: 'empaquetado', def: 'Acomodar pods en la menor cantidad de nodos. Con GPUs aparece la fragmentación: GPUs libres repartidas entre nodos donde un pod de varias GPUs no cabe.', say: 'Mixing one-GPU and eight-GPU pods on the same pool fragments capacity.' },
      { en: 'Prometheus Adapter', es: 'Prometheus Adapter', def: 'Componente que traduce queries de Prometheus a la API de métricas custom de Kubernetes para que el HPA pueda usarlas.', say: 'Prometheus Adapter exposes pending requests per pod so the HPA can scale on them.' },
      { en: 'KServe', es: 'KServe', def: 'Capa de serving sobre Kubernetes (recurso InferenceService): servidor de modelos, autoscaling por concurrencia con Knative o con HPA/KEDA, canary y el protocolo de inferencia v2.', say: 'On a cluster we already run, KServe gives us concurrency-based autoscaling and canaries without writing that plumbing ourselves.' },
      { en: 'ScaledObject', es: 'ScaledObject (KEDA)', def: 'Recurso de KEDA que asocia un Deployment con triggers (una query, una cola). KEDA crea el HPA, le publica la métrica y maneja el paso de 0 a 1 y de 1 a 0.', say: 'The ScaledObject keeps Triton between two and four replicas based on queue time.' },
      { en: 'ScaledJob', es: 'ScaledJob (KEDA)', def: 'Recurso de KEDA que crea Jobs según los eventos pendientes. Cada Job termina su trabajo, así que sirve para tareas largas; paga el arranque en cada Job.', say: 'Long video jobs run as a ScaledJob so a scale-in never kills work in progress.' },
      { en: 'scale to zero', es: 'escalar a cero', def: 'Bajar un servicio a 0 réplicas cuando no hay carga. Ahorra la GPU completa; el primer request después paga el cold start entero.', say: 'The OCR workers scale to zero at night; the online tier never does.' },
      { en: 'stabilization window', es: 'ventana de estabilización', def: 'Periodo en que el HPA considera sus recomendaciones anteriores antes de actuar (por defecto 300 s al bajar, 0 al subir) para no oscilar.', say: 'A ten-minute scale-down stabilization window keeps the GPU count from flapping.' },
      { en: 'Cluster Autoscaler', es: 'Cluster Autoscaler', def: 'Autoscaler de nodos del proyecto Kubernetes: agranda o achica node groups cuando hay pods Pending o nodos subutilizados.', say: 'Cluster Autoscaler grows the GPU node group when Triton pods go pending.' },
      { en: 'Karpenter', es: 'Karpenter', def: 'Autoscaler de nodos que lanza instancias sueltas elegidas según los pods pendientes (sin node groups) y consolida los nodos que sobran. Nació en AWS.', say: 'Karpenter can fall back to another T4 size or zone when one runs out of capacity.' },
      { en: 'overprovisioning', es: 'sobreaprovisionamiento', def: 'Mantener capacidad de reserva con pods placeholder de prioridad baja que cualquier pod real desaloja. Evita esperar un nodo nuevo, a cambio de pagarlo siempre.', say: 'A single overprovisioned T4 node saves us the node cold start on every deploy.' },
      { en: 'insufficient capacity error (ICE)', es: 'error de capacidad insuficiente', def: 'Respuesta de la nube (en EC2, InsufficientInstanceCapacity) cuando no hay instancias de un tipo en una zona. Frecuente con GPUs; se mitiga con varios tipos y zonas o reservas.', say: 'GPU capacity can run out in a zone, so the node pool allows two T4 sizes in each zone.' },
      { en: 'scheduled scaling', es: 'escalado programado', def: 'Subir réplicas o nodos antes de un pico conocido, por horario, en vez de esperar a que la métrica reaccione.', say: 'For the Hot Sale we scale ahead on a schedule instead of waiting for the autoscaler.' },
      { en: 'serverless inference', es: 'inferencia serverless', def: 'Servir un modelo pagando por uso mientras el proveedor escala, a veces hasta cero. Conviene con tráfico esporádico; con tráfico continuo pagas todas las horas con sobreprecio.', say: 'Serverless inference fits the internal tool; our 24/7 path would pay for every hour anyway.' },
      { en: 'topology spread constraints', es: 'restricciones de reparto por topología', def: 'Reglas del pod (topologySpreadConstraints) que reparten réplicas entre zonas o nodos con un desbalance máximo (maxSkew).', say: 'A topology spread constraint keeps one Triton replica per zone.' },
      { en: 'voluntary disruption', es: 'disrupción voluntaria', def: 'Salida de un pod provocada a propósito (drain, upgrade, consolidación). Solo esas, por la Eviction API, las limita un PodDisruptionBudget.', say: 'The PDB covers voluntary disruptions; node failures are what the N+1 is for.' },
      { en: 'graceful shutdown', es: 'apagado ordenado', def: 'Secuencia que evita cortar requests al terminar un pod: salir de los endpoints, preStop, SIGTERM y drenado, todo dentro de terminationGracePeriodSeconds.', say: 'Graceful shutdown is a ten-second preStop plus thirty seconds of draining, inside a sixty-second grace period.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
