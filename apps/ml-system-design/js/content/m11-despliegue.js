/* =============================================================================
   Ronda de Diseño ML — js/content/m11-despliegue.js
   Módulo 11: despliegue seguro. La escalera offline → shadow → canary → A/B → 100 %,
   blue/green, tamaño de muestra y trampas del A/B, interleaving y bandits,
   compatibilidad entre versiones (flags, contratos, labels), rollback automático y
   por qué las métricas offline y online no coinciden.
   Contrato: docs/SPEC.md §5. Los números de los casos son los de c01-clasificacion.js,
   c02-video.js y c03-inspeccion.js: si cambian allá, se cambian aquí.
   Verificado (sept. 2026) contra la documentación oficial: Argo Rollouts (canary con
   setWeight/pause/analysis, AnalysisTemplate con Prometheus, tráfico por réplicas sin
   trafficRouting, blue/green con scaleDownDelaySeconds = 30 s por defecto, ALB con AWS
   Load Balancer Controller), Flagger (canary, A/B, blue/green y mirroring; proyecto
   graduado de la CNCF dentro de Flux), SageMaker deployment guardrails (all at once,
   canary y linear con baking period y rollback por alarmas de CloudWatch; rolling) y
   shadow tests, pesos 0–999 de los target groups del ALB (sin failover automático entre
   ellos) y la cookie AWSALBTG, Istio mirroring (fire and forget, mirrorPercentage,
   sufijo -shadow), KServe canaryTrafficPercent (solo modo serverless), trafficSplit de
   Vertex AI y OpenFeature (incubating en la CNCF). El dato de interleaving es del blog
   de Netflix (2017). Tamaños de muestra, SRM, canary y la simulación de peeking se
   calcularon con Python (stdlib + numpy); el snippet de Python corrió tal cual y el
   YAML se parseó con PyYAML.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // Marca de estimación (SPEC §5.3): subrayado punteado + "est."
  const E = (s) => '<span class="est">' + s + '</span>';

  // ------------------------------------------------------------ diagramas
  // La escalera. Arriba, los peldaños (izquierda sin usuarios, derecha con usuarios);
  // abajo, la guardia automática que compara contra el estable y revierte. Columnas
  // x = 1, 23, 46, 68, 91 con huecos de 6 unidades para las etiquetas. El rollback vuelve
  // al estable por debajo de la fila de guardia (y 40.5) para no cruzar nodos.
  const ESCALERA = {
    width: 108, height: 43,
    lanes: [
      { id: 'sin', label: 'Sin exponer usuarios', x: 0, y: 0, w: 42, h: 22, kind: 'offline' },
      { id: 'con', label: 'Usuarios expuestos', x: 44, y: 0, w: 64, h: 22, kind: 'online' },
      { id: 'guardia', label: 'Guardia automática y vuelta atrás', x: 0, y: 24, w: 108, h: 19, kind: 'monitor' },
    ],
    nodes: [
      { id: 'gate', label: 'Gate offline', sub: 'golden set · parity', x: 1, y: 8, w: 16, h: 8, kind: 'job',
        note: 'El primer peldaño no toca producción: métricas sobre el golden set por slice, parity test del artefacto que se va a servir y un gate de rendimiento con perf_analyzer. Es necesario, no suficiente: dice que el modelo es mejor sobre datos etiquetados, no que mejora el producto. Se ve en <a href="#m10.gate">M10</a>.' },
      { id: 'shadow', label: 'Shadow', sub: 'copia; nadie la ve', x: 23, y: 8, w: 17, h: 8, kind: 'model',
        note: 'El challenger recibe una copia de requests reales y su respuesta se descarta. Atrapa crashes, inputs inesperados, skew y regresiones de latencia sin que un usuario vea nada. No puede medir cómo reaccionan los usuarios, porque nadie vio sus predicciones.' },
      { id: 'canary', label: 'Canary', sub: '5 → 25 → 100 %', x: 46, y: 8, w: 16, h: 8, kind: 'service',
        note: 'Una fracción chica del tráfico real recibe la respuesta del modelo nuevo. Pregunta operativa: ¿es seguro? Se compara contra el estable en la misma ventana y se revierte solo si un criterio se rompe.' },
      { id: 'ab', label: 'A/B test', sub: 'por vendedor · 1–2 sem', x: 68, y: 8, w: 17, h: 8, kind: 'service',
        note: 'Opcional según el cambio. Unidades aleatorizadas (en c01, vendedores) ven un modelo u otro durante 1–2 semanas; se mide la métrica primaria con sus guardrails. Es el único peldaño que responde "¿mejora el producto?".' },
      { id: 'full', label: 'Promoción', sub: '100 % · alias champion', x: 91, y: 8, w: 16, h: 8, kind: 'job',
        note: 'El modelo nuevo sirve el 100 % y el alias champion del registry apunta a él. La release anterior sigue viva un tiempo (bake) para que volver sea un cambio de ruteo y no un redeploy.' },
      { id: 'estable', label: 'Release estable', sub: 'champion actual', x: 1, y: 29, w: 16, h: 8, kind: 'service',
        note: 'La referencia de todo: cada métrica del shadow y del canary se compara contra el champion en la misma ventana, no contra un valor histórico. Es también a donde vuelve el tráfico en un rollback.' },
      { id: 'logs', label: 'Logs pareados', sub: 'mismo request_id', x: 23, y: 29, w: 17, h: 8, kind: 'store',
        note: 'En shadow, cada request deja dos respuestas con el mismo request_id: la del champion y la del challenger. Esa comparación pareada (mismo input, dos modelos) es mucho más sensible que comparar dos poblaciones distintas.' },
      { id: 'analisis', label: 'Análisis canary', sub: 'vs estable, misma ventana', x: 46, y: 29, w: 16, h: 8, kind: 'monitor',
        note: 'Consultas automáticas cada pocos minutos: 5xx, p99, tasa de baja confianza y distribución de predicciones del canary contra el estable. En Argo Rollouts es un AnalysisTemplate; en SageMaker, alarmas de CloudWatch durante el baking period.' },
      { id: 'rollback', label: 'Rollback', sub: 'tráfico al estable', x: 68, y: 29, w: 17, h: 8, kind: 'job',
        note: 'Automático: si un criterio se rompe, el peso vuelve al estable en segundos, sin esperar a que alguien despierte. Un guardrail roto en el A/B también detiene el experimento.' },
    ],
    edges: [
      { from: 'gate', to: 'shadow', kind: 'offline', label: 'pasa' },
      { from: 'shadow', to: 'canary', kind: 'online', label: 'pasa' },
      { from: 'canary', to: 'ab', kind: 'online', label: 'sano' },
      { from: 'ab', to: 'full', kind: 'online', label: 'gana' },
      { from: 'shadow', to: 'logs', kind: 'monitor', fromSide: 'b', toSide: 't', label: 'respuesta' },
      { from: 'estable', to: 'logs', kind: 'monitor' },
      { from: 'canary', to: 'analisis', kind: 'monitor', fromSide: 'b', toSide: 't', label: 'métricas' },
      { from: 'analisis', to: 'rollback', kind: 'monitor', label: 'falla' },
      { from: 'ab', to: 'rollback', kind: 'monitor', fromSide: 'b', toSide: 't', label: 'guardrail roto' },
      { from: 'rollback', to: 'estable', kind: 'monitor', fromSide: 'b', toSide: 'b', via: [[76.5, 40.5], [9, 40.5]], label: 'vuelve al 100 %' },
    ],
    flows: [
      { id: 'sube', label: 'Un modelo nuevo sube la escalera', steps: [
        { nodes: ['gate'], edges: [], text: 'El challenger pasa el gate offline: golden set por slice, parity del engine FP16 contra PyTorch y p99 con perf_analyzer. Sin esto no se expone a nada.' },
        { nodes: ['gate', 'shadow', 'logs', 'estable'], edges: ['gate>shadow', 'shadow>logs', 'estable>logs'], text: 'Shadow 1–2 días: recibe una copia de una muestra del tráfico. Por cada request quedan dos respuestas con el mismo request_id; se miden acuerdo, latencia, errores y distribución.' },
        { nodes: ['canary', 'analisis'], edges: ['shadow>canary', 'canary>analisis'], text: 'Canary 5 % → 25 % → 100 %, con horas por etapa y al menos un pico diurno. El análisis compara contra el estable en la misma ventana.' },
        { nodes: ['ab'], edges: ['canary>ab'], text: 'Si el cambio es grande (arquitectura nueva, otro set de labels), A/B de 1–2 semanas aleatorizado por vendedor sobre la tasa de aceptación, con guardrails.' },
        { nodes: ['full'], edges: ['ab>full'], text: 'Promoción: 100 % y alias champion en la versión nueva. La release anterior queda viva 24–48 h para volver con un cambio de ruteo.' },
      ] },
      { id: 'falla', label: 'El canary se rompe', steps: [
        { nodes: ['canary', 'analisis'], edges: ['canary>analisis'], text: 'En la etapa de 5 %, la tasa de baja confianza del canary llega a 1.8× la del estable durante 30 min.' },
        { nodes: ['analisis', 'rollback'], edges: ['analisis>rollback'], text: 'El criterio es automático: el análisis falla y el rollout se aborta. Nadie tiene que estar mirando un dashboard.' },
        { nodes: ['rollback', 'estable'], edges: ['rollback>estable'], text: 'El peso vuelve al estable en segundos. Solo el 5 % de los requests de esa media hora vio el modelo malo. Después, sin prisa, se investiga.' },
      ] },
    ],
  };

  // Shadow en c01. Carril online arriba (y 0–31) y offline abajo (y 33–47). El gateway
  // manda la copia por abajo (y 25) y el request real por arriba (y 7); el log cruza entre
  // los dos Tritons por y 16, donde hay 10 unidades libres.
  const SOMBRA = {
    width: 100, height: 47,
    lanes: [
      { id: 'online', label: 'Online · cada request', x: 0, y: 0, w: 100, h: 31, kind: 'online' },
      { id: 'offline', label: 'Offline · comparación', x: 0, y: 33, w: 100, h: 14, kind: 'offline' },
    ],
    nodes: [
      { id: 'caller', label: 'Backend', sub: 'publicación', x: 1, y: 12, w: 14, h: 8, kind: 'client',
        note: 'El backend de publicación del marketplace. No sabe que hay un shadow: su request y su latencia son las de siempre.' },
      { id: 'gw', label: 'Gateway vN', sub: 'responde al usuario', x: 21, y: 12, w: 18, h: 8, kind: 'service',
        note: 'Llama al champion de forma síncrona y responde. Para una muestra de requests (por ejemplo el 10 %), lanza además una copia asíncrona al challenger con su propio timeout y una cola acotada: si la cola se llena, la copia se descarta. El shadow nunca puede sumar latencia al camino del usuario.' },
      { id: 'tvs', label: 'Triton champion', sub: 'la respuesta que se ve', x: 48, y: 3, w: 20, h: 8, kind: 'gpu',
        note: 'El modelo en producción, con su capacidad de siempre. No sabe nada del shadow.' },
      { id: 'tvc', label: 'Triton challenger', sub: 'shadow · réplica aparte', x: 48, y: 21, w: 20, h: 8, kind: 'gpu',
        note: 'El modelo nuevo en su propio Deployment y su propia GPU: si se cae o se satura, al champion no le pasa nada. Cuesta una T4 extra mientras dura el shadow (en c01, ' + E('≈ US$25–50') + ' por release junto con el bake). Su p99 solo es comparable si corre en el mismo tipo de GPU y con un batching parecido.' },
      { id: 'logs', label: 'Logs de predicción', sub: 'request_id · versión', x: 78, y: 12, w: 20, h: 8, kind: 'store',
        note: 'Una línea por respuesta, con request_id, model_version y un campo <code>shadow=true</code> en la del challenger. Las métricas del shadow llevan su propia etiqueta: si se mezclan con las del champion, ensucias los dashboards y las alertas de producción.' },
      { id: 'job', label: 'Job de comparación', sub: 'acuerdo · p99 · PSI', x: 78, y: 36, w: 20, h: 8, kind: 'job',
        note: 'Une las dos respuestas por request_id: top-1 agreement, solapamiento del top-5, diferencia de p99, errores y timeouts, PSI de la distribución de categorías y de la confianza. Separa por slice (móvil vs web, categorías grandes vs long tail).' },
      { id: 'rev', label: 'Revisión humana', sub: 'desacuerdos muestreados', x: 48, y: 36, w: 20, h: 8, kind: 'human',
        note: 'El acuerdo no dice quién tiene razón. Una muestra de los desacuerdos va a etiquetado: si en esos casos el challenger acierta más que el champion, la ganancia offline se sostiene con tráfico real.' },
      { id: 'dec', label: 'Pasa al canary', sub: 'criterios escritos antes', x: 20, y: 36, w: 18, h: 8, kind: 'job',
        note: 'La decisión se toma contra criterios fijados antes de mirar: acuerdo mínimo, p99 no peor que el champion más un margen, cero crashes, ningún slice con una caída clara. Si los decides después de ver los números, siempre vas a encontrar una razón para avanzar.' },
    ],
    edges: [
      { from: 'caller', to: 'gw', kind: 'online', label: 'HTTPS' },
      { from: 'gw', to: 'tvs', kind: 'online', fromSide: 't', toSide: 'l', via: [[30, 7]], label: 'síncrono' },
      { from: 'gw', to: 'tvc', kind: 'async', fromSide: 'b', toSide: 'l', via: [[30, 25]], label: 'copia async' },
      { from: 'gw', to: 'logs', kind: 'monitor', label: 'ambas respuestas' },
      { from: 'logs', to: 'job', kind: 'offline', fromSide: 'b', toSide: 't', label: 'lote diario' },
      { from: 'job', to: 'rev', kind: 'offline', label: 'muestra' },
      { from: 'rev', to: 'dec', kind: 'offline', label: 'veredicto' },
    ],
    flows: [
      { id: 'request', label: 'Un request en shadow', steps: [
        { nodes: ['caller', 'gw'], edges: ['caller>gw'], text: 'Llega la foto. El gateway decide con un hash del request_id si este request entra en la muestra del shadow (por ejemplo, 10 %).' },
        { nodes: ['gw', 'tvs'], edges: ['gw>tvs'], text: 'Camino normal: el champion responde, el gateway arma el top-5 y contesta. El usuario ve esto y nada más.' },
        { nodes: ['gw', 'tvc'], edges: ['gw>tvc'], text: 'En paralelo y sin esperar, la copia va al challenger con su propio timeout. Si tarda, falla o la cola de copias está llena, se descarta: nunca bloquea la respuesta.' },
        { nodes: ['gw', 'logs'], edges: ['gw>logs'], text: 'Quedan dos líneas con el mismo request_id: la del champion y la del challenger (<code>shadow=true</code>).' },
      ] },
      { id: 'decision', label: 'Del log a la decisión', steps: [
        { nodes: ['logs', 'job'], edges: ['logs>job'], text: 'Una vez al día, el job une las respuestas: al 10 % de 10 M imágenes/día son ≈ 1 M pares por día.' },
        { nodes: ['job', 'rev'], edges: ['job>rev'], text: 'Con un acuerdo top-1 de ' + E('≈ 92 %') + ' hay ≈ 80k desacuerdos; unos cientos van a etiquetado humano para saber quién acierta.' },
        { nodes: ['rev', 'dec'], edges: ['rev>dec'], text: 'Si el challenger gana en los desacuerdos, no rompe ningún slice y su p99 no empeora, pasa al canary.' },
      ] },
    ],
  };

  // ------------------------------------------------------------ código
  // YAML parseado con PyYAML. Argo Rollouts con ALB: requiere AWS Load Balancer Controller.
  const ROLLOUT = `# Rollout del gateway de c01: el canary habla con triton-vN+1, desplegado antes y sin tráfico
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: gateway
spec:
  selector:
    matchLabels: {app.kubernetes.io/name: gateway}
  template:
    metadata:
      labels: {app.kubernetes.io/name: gateway}
    spec:
      containers:
        - name: gateway
          image: registry.example.com/classifier-gateway@sha256:...   # digest, nunca un tag móvil
          env:
            - {name: TRITON_URL, value: "triton-v2:8000"}               # su propio Triton
            - {name: MODEL_VERSION, value: "2026-10-01-resnet50-fp16"}
  strategy:
    canary:
      canaryService: gateway-canary      # Service que ve solo los pods nuevos
      stableService: gateway-stable      # Service que ve solo los pods estables
      trafficRouting:
        alb: {ingress: classifier, servicePort: 8080}   # el Ingress apunta a gateway-stable; pesos exactos en el ALB
      analysis:                          # análisis de fondo durante todo el canary
        templates: [{templateName: canary-vs-estable}]
        startingStep: 1
        args:
          - {name: canary-version, value: "2026-10-01-resnet50-fp16"}
          - {name: stable-version, value: "2026-09-01-resnet50-fp16"}
      steps:
        - setWeight: 5
        - pause: {duration: 4h}          # horas, no minutos: tiene que cubrir tráfico real
        - setWeight: 25
        - pause: {}                      # sin duración: promoción manual después de un pico diurno
        - setWeight: 100`;

  const ANALYSIS = `apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: canary-vs-estable
spec:
  args:
    - name: canary-version
    - name: stable-version
  metrics:
    - name: tasa-5xx                     # absoluta: > 0.5 % de los requests válidos aborta
      interval: 10m
      failureLimit: 0                    # una medición mala basta
      successCondition: result[0] < 0.005
      provider:
        prometheus:
          address: http://prometheus.monitoring:9090
          query: |
            sum(rate(classifier_requests_total{model_version="{{args.canary-version}}",status=~"5.."}[10m]))
            /
            sum(rate(classifier_requests_total{model_version="{{args.canary-version}}",status!~"4.."}[10m]))
    - name: baja-confianza-relativa      # relativa: canary / estable en la misma ventana
      interval: 30m
      failureLimit: 0
      successCondition: result[0] < 1.5
      provider:
        prometheus:
          address: http://prometheus.monitoring:9090
          query: |
            (sum(rate(classifier_top1_score_bucket{le="0.3",model_version="{{args.canary-version}}"}[30m]))
              / sum(rate(classifier_top1_score_count{model_version="{{args.canary-version}}"}[30m])))
            /
            (sum(rate(classifier_top1_score_bucket{le="0.3",model_version="{{args.stable-version}}"}[30m]))
              / sum(rate(classifier_top1_score_count{model_version="{{args.stable-version}}"}[30m])))`;

  // Corrió con Python 3.13 (solo stdlib): imprime 32647, 131229, 8080 y el chequeo de SRM.
  const AB_PY = `from math import ceil, sqrt
from statistics import NormalDist

Z = NormalDist().inv_cdf

def n_por_brazo(p1, p2, alpha=0.05, potencia=0.8):
    """Tamaño de muestra por brazo para comparar dos proporciones (test bilateral)."""
    za, zb = Z(1 - alpha / 2), Z(potencia)
    pm = (p1 + p2) / 2
    num = (za * sqrt(2 * pm * (1 - pm)) + zb * sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2
    return ceil(num / (p2 - p1) ** 2)

def srm_p(n_a, n_b, esperado_a=0.5):
    """p-value de chi-cuadrado (1 grado de libertad) para el reparto observado."""
    total = n_a + n_b
    ea, eb = total * esperado_a, total * (1 - esperado_a)
    chi2 = (n_a - ea) ** 2 / ea + (n_b - eb) ** 2 / eb
    return 2 * (1 - NormalDist().cdf(sqrt(chi2)))

print(n_por_brazo(0.70, 0.71))    # 32647  → ≈ 33k por brazo (c01)
print(n_por_brazo(0.70, 0.705))   # 131229 → la mitad de MDE cuesta 4× la muestra
print(n_por_brazo(0.70, 0.72))    # 8080
print(f"{srm_p(50_600, 49_400):.5f}")  # 0.00015 → reparto roto: no leas el resultado
print(f"{srm_p(50_150, 49_850):.2f}")  # 0.34 → normal`;

  // ------------------------------------------------------------ registro
  MSD.register({
    id: 'm11',
    kind: 'module',
    sections: [
      // ======================================================== 1
      {
        id: 'por-que',
        title: 'Por qué desplegar es un riesgo aparte',
        titleEn: 'Why deployment is its own risk',
        priority: 'core',
        dims: ['monitoreo', 'tradeoffs', 'comunicacion'],
        blocks: [
          { t: 'p', html: `Tienes un challenger para el <a href="#c01">caso 1</a> que gana 1.5 pp de top-5 sobre el golden set. Lo despliegas al 100 % un martes y el miércoles la tasa de aceptación de sugerencias cayó. ¿Qué pasó? Hay al menos tres explicaciones distintas, y cada una la atrapa un mecanismo distinto: el modelo nuevo es más pesado y en el pico sube la tasa de timeouts, así que más vendedores ven el selector manual (un problema <b>técnico</b>); gana en categorías que casi no se usan y pierde en las grandes (un problema de <b>calidad del modelo</b> que el promedio escondía); o acierta más en las posiciones 4–5 pero menos en la 1, y los vendedores casi siempre eligen la primera (un problema de <b>negocio</b>: la métrica offline no era la del producto).` },
          { t: 'p', html: `Desplegar de forma segura es exponer el cambio a tráfico real <b>de a poco</b>, <b>midiendo contra lo que ya funciona</b> y con una <b>vuelta atrás automática</b>. Es un tema de entrevista frecuente porque separa a quien entrenó modelos de quien los operó: el candidato junior termina su diseño en "y lo despliego"; el senior dice cómo sabe que no rompió nada.` },
          { t: 'table', caption: 'Tres tipos de riesgo, tres velocidades', head: ['Riesgo', 'Ejemplos', 'Cuándo se ve', 'Qué lo atrapa'], rows: [
            ['Técnico', 'Latencia, 5xx, OOM, crash al cargar el engine, timeouts, más CPU de preprocesamiento', 'Minutos', 'Shadow y canary con métricas de sistema'],
            ['Calidad del modelo', 'Peores predicciones en un slice, skew de preprocesamiento, labels desalineados, distribución de predicciones rara', 'Horas a días (sin labels, solo con señales indirectas)', 'Shadow pareado, canary con métricas de modelo, revisión humana de desacuerdos'],
            ['Negocio', 'Los usuarios reaccionan distinto: aceptan menos, tardan más, corrigen después', 'Días a semanas', 'A/B test con métrica primaria y guardrails'],
          ] },
          { t: 'diagram', id: 'escalera-despliegue', title: 'La escalera: cada peldaño expone más y responde otra pregunta', caption: 'Arriba, los peldaños; abajo, la guardia que compara contra el estable y revierte sola. Toca cada caja y recorre los dos flujos.', spec: ESCALERA },
          { t: 'table', caption: 'Los peldaños en c01', head: ['Peldaño', 'Pregunta', 'Exposición', 'Duración en c01', 'Qué no puede ver'], rows: [
            ['Gate offline', '¿Es mejor sobre datos etiquetados?', 'Nadie', 'Una corrida de CI', 'Tráfico real, latencia bajo carga, comportamiento del usuario'],
            ['Shadow', '¿Funciona con tráfico real?', 'Nadie (respuesta descartada)', '1–2 días', 'Cómo reacciona el usuario'],
            ['Canary', '¿Es seguro operativamente?', '5 % → 25 % → 100 % de requests', 'Horas por etapa', 'Efectos chicos en el negocio (muestra corta, sin aleatorizar por usuario)'],
            ['A/B test', '¿Mejora el producto?', 'Brazos por vendedor, p. ej. 50/50', '1–2 semanas', 'Efectos de largo plazo (para eso, un holdout)'],
            ['Promoción', '—', '100 %', 'Bake de 24–48 h con la anterior viva', '—'],
          ] },
          { t: 'p', html: `No todo cambio sube todos los peldaños. El costo de cada uno tiene que corresponder al riesgo del cambio:` },
          { t: 'table', head: ['Cambio', 'Peldaños', 'Por qué'], rows: [
            ['Reentrenamiento mensual, misma arquitectura y labels', 'Gate → shadow → canary', 'El riesgo es de calidad y técnico; el efecto en el producto debería ser chico y ya lo validó el gate'],
            ['Arquitectura nueva, set de labels nuevo, otro preprocesamiento', 'Todos, con A/B', 'Puede mover el comportamiento del vendedor: solo un A/B lo mide'],
            ['Upgrade de Triton o de TensorRT, mismo modelo', 'Parity → shadow → canary', 'Las predicciones deberían ser idénticas: el shadow lo confirma con acuerdo ≈ 100 %'],
            ['Cambio de umbral o de top-k', 'Canary o A/B según el efecto esperado', 'No cambia el modelo pero sí lo que ve el usuario (en <a href="#c03">c03</a>, cambiar un umbral es un release con su shadow)'],
          ] },
          { t: 'callout', kind: 'trap', title: 'Un rolling update no es un despliegue seguro de un modelo', html: `<p>El rolling update de Kubernetes (<a href="#m06.alta-disponibilidad">M6</a>) reemplaza pods de a poco y se detiene si los nuevos no pasan la readiness. Pero la readiness pregunta "¿el proceso está vivo y cargó el modelo?", no "¿las predicciones son buenas?". Un modelo que devuelve categorías equivocadas con confianza alta pasa todas las probes. Y como el tráfico se reparte según cuántos pods nuevos hay, no controlas el porcentaje ni comparas contra nada. Para un modelo necesitas un criterio de calidad además del de salud.</p>` },
          { t: 'callout', kind: 'senior', html: `<p>Lo que anota el entrevistador: que <b>separas las tres preguntas</b> (¿es mejor offline?, ¿es seguro?, ¿mejora el producto?) y eliges el mecanismo por pregunta, que <b>comparas contra el estable en la misma ventana</b> y que el <b>rollback es automático</b> y está pensado antes del despliegue, no durante el incidente.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"Offline evaluation tells me the model is better on labeled data, not that it's safe or that it helps the product. So it goes through shadow first, then a canary at five percent with automatic rollback against the stable version, and if the change is big, an A/B test on acceptance rate."</p>` },
          { t: 'callout', kind: 'connect', html: `<p>El gate offline y el registry con champion/challenger son de <a href="#m10.gate">M10</a>. Los dashboards y alertas que siguen vigilando después de la promoción, de <a href="#m12">M12</a>. Aquí está todo lo que pasa entre los dos.</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'shadow',
        title: 'Shadow deployment: comparar sin afectar a nadie',
        titleEn: 'Shadow deployment',
        priority: 'core',
        dims: ['monitoreo', 'arquitectura'],
        blocks: [
          { t: 'p', html: `En <b>shadow</b> (también <span class="en">dark launch</span> o <span class="en">traffic mirroring</span>), el modelo nuevo recibe una copia de requests reales, calcula su respuesta y esa respuesta se guarda y se descarta: el usuario solo ve la del champion. Es el peldaño más barato en riesgo, porque un challenger que se cae o dice tonterías no le hace nada a nadie.` },
          { t: 'diagram', id: 'shadow-c01', title: 'Shadow en c01: la copia va aparte y la comparación es offline', caption: 'El request real sigue su camino; la copia es asíncrona y descartable. Toca las cajas y recorre los flujos.', spec: SOMBRA },
          { t: 'h3', text: 'Dónde se hace la copia' },
          { t: 'table', head: ['Dónde', 'Cómo', 'Cuándo conviene'], rows: [
            ['En tu gateway o aplicación', 'Una tarea asíncrona con timeout propio, muestra por hash y cola acotada', 'Quieres controlar la muestra, el logging pareado y qué se omite (c01)'],
            ['En la malla o el proxy', 'Istio: <code>mirror</code> con <code>mirrorPercentage</code>; la copia es <i>fire and forget</i> (la respuesta se descarta) y el Host lleva el sufijo <code>-shadow</code>', 'Ya hay service mesh y el servicio no tiene efectos secundarios'],
            ['En la plataforma administrada', 'SageMaker shadow tests: una variante shadow en el mismo endpoint; solo la variante de producción responde y la de shadow se puede loguear', 'Endpoints de SageMaker en tiempo real (no aplica a serverless, async ni multi-model)'],
            ['Offline, con replay', 'Vuelves a pasar inputs guardados por el challenger', 'Tienes los inputs y no necesitas medir latencia real; en c01 solo se guardan referencias de una muestra, así que el replay es sobre esa muestra'],
          ] },
          { t: 'h3', text: 'Qué comparas' },
          { t: 'table', head: ['Métrica', 'Qué te dice', 'Cuidado con'], rows: [
            ['Top-1 agreement y solapamiento del top-5', 'Cuánto cambian las respuestas', 'No dice quién tiene razón: los desacuerdos hay que etiquetarlos'],
            ['p50 / p99 y timeouts', 'Si el modelo nuevo cabe en el presupuesto de latencia', 'Solo es comparable con el mismo tipo de GPU y un batching parecido: un challenger solo en su T4 arma batches distintos'],
            ['Tasa de errores y crashes', 'Inputs que el modelo nuevo no aguanta', 'Un error del shadow no debe contar en el SLO de producción'],
            ['Distribución de predicciones (PSI vs champion)', 'Si el modelo "se fue" hacia algunas categorías', 'Con 500 categorías, agrupa o exige un n mínimo (piso de ruido en <a href="#c01.evaluacion">c01</a>)'],
            ['Distribución de confianza', 'Calibración cambiada, más o menos casos de baja confianza', 'Una confianza más alta no es mejor por sí sola'],
            ['Por slice', 'Móvil vs web, head vs long tail, poca luz', 'El promedio esconde el slice roto'],
          ] },
          { t: 'calc', title: 'Cuánto junta un día de shadow en c01', rows: [
            { label: 'Tráfico', expr: '10 M imágenes/día', value: '10 M' },
            { label: 'Muestra copiada', expr: '10 %', value: '≈ 1 M pares/día' },
            { label: 'Desacuerdos top-1', expr: '1 M × (1 − 0.92)', value: '≈ 80k', note: 'con un acuerdo supuesto de ' + E('92 %') },
            { label: 'A revisión humana', expr: 'muestra aleatoria de los desacuerdos', value: E('≈ 300–500') },
          ], result: 'No te falta volumen: te falta saber quién acierta en los desacuerdos. Por eso el shadow termina en etiquetado, no en un número de acuerdo.' },
          { t: 'h3', text: 'Lo que cuesta' },
          { t: 'list', items: [
            '<b>Inferencia doble</b> sobre la muestra. En c01, el challenger vive en su propia T4 mientras dura el shadow (' + E('≈ US$0.53/h') + '); junto con el bake de la release anterior son ' + E('≈ US$25–50') + ' por release (<a href="#c01.costo">costo de c01</a>). En un sistema que ya usa muchas GPUs, un shadow al 100 % duplica esa factura: por eso se usa una muestra.',
            '<b>Red y logs</b>: una línea más por request copiado y, si la copia se hace en el gateway, su CPU. Nada grave, pero cuéntalo.',
            '<b>Tiempo de ingeniería</b>: el job de comparación, el etiquetado de desacuerdos y la disciplina de fijar criterios antes de mirar.',
          ] },
          { t: 'callout', kind: 'trap', title: 'Efectos secundarios: el shadow no puede escribir en el mundo', html: `<p>El shadow ve requests reales, así que si su código "hace algo", lo hace de verdad. Antes de encenderlo, revisa que el challenger <b>no</b>: escriba en la base de datos del producto, mande notificaciones o correos, cobre, consuma cuota de un caller o incremente contadores de rate limiting, escriba en el prediction cache compartido o en el feature store, llame a una API externa de pago (duplicarías la factura), o dispare actuadores. En <a href="#c03">c03</a>, el shadow nunca escribe al PLC; en <a href="#c02">c02</a>, sus eventos no llegan al SOC. Y sus métricas llevan su propia etiqueta, para no mezclarse con las alertas de producción.</p>` },
          { t: 'callout', kind: 'trap', title: 'El shadow no mide al usuario', html: `<p>La tasa de aceptación de c01 exige que el vendedor <b>vea</b> las sugerencias del challenger. En shadow nadie las vio, así que no hay aceptación que medir, ni cambios de comportamiento, ni feedback loops. "Lo dejo un mes en shadow y veo si mejora el negocio" no funciona: el shadow responde "¿funciona?", no "¿ayuda?".</p>` },
          { t: 'h3', text: 'Shadow en los otros casos' },
          { t: 'table', head: ['Caso', 'Cómo es el shadow', 'Criterio para avanzar'], rows: [
            ['<a href="#c01.evaluacion">c01</a> marketplace', 'Copia asíncrona de una muestra, 1–2 días, Triton aparte', 'Acuerdo y desacuerdos revisados, p99 y errores no peores, ningún slice roto'],
            ['<a href="#c02.evaluacion">c02</a> video', 'El detector nuevo corre en paralelo en 10 cámaras de 2 sitios y solo loguea; los sitios nuevos pasan su primera semana en shadow', 'Candidatos por hora vs champion, acuerdo por evento, latencia por frame'],
            ['<a href="#c03.evaluacion">c03</a> inspección', 'Un turno completo en la línea 1: el challenger corre <b>después</b> de que la decisión del champion ya se escribió al PLC, en el mismo Jetson; si se acerca el siguiente trigger, esa pieza se salta (<a href="#c03.serving">c03 serving</a>)', 'No pierde ningún defecto que el champion detectó, no sube los FP, cero deadline misses'],
          ] },
          { t: 'p', html: `El de c03 muestra el cuidado extra del edge: el shadow comparte el dispositivo con el champion, así que puede robarle GPU. Por eso corre después de la decisión y se salta piezas si no cabe; la métrica que decide no es solo la del challenger, también que el <b>champion</b> no empiece a perder deadlines. ¿Por qué un turno entero? Cubre el cambio de luz ambiente, el calentamiento del equipo y, muchas veces, un cambio de lote: 57,600 piezas, ≈ 288 defectos y, con 99.8 % de acuerdo, ≈ 115 desacuerdos que calidad revisa uno por uno.` },
          { t: 'callout', kind: 'interview', html: `<p>"Before any user sees it, the challenger runs in shadow on a ten percent sample for a day or two. The gateway sends an async copy with its own timeout, logs both answers under the same request ID, and never writes anything from the shadow path. We compare agreement, p99 and prediction distribution by slice, and label a sample of the disagreements to see which model is right."</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'canary',
        title: 'Canary: porcentajes, tiempos y criterios para avanzar',
        titleEn: 'Canary releases',
        priority: 'core',
        dims: ['monitoreo', 'estimaciones'],
        blocks: [
          { t: 'p', html: `En un <b>canary</b>, una fracción chica del tráfico real recibe la respuesta del modelo nuevo mientras el resto sigue en el estable. Avanza por etapas (en <a href="#c01.evaluacion">c01</a>, 5 % → 25 % → 100 %) y en cada una se compara el canary contra el estable <b>en la misma ventana</b>. Si un criterio se rompe, el tráfico vuelve al estable sin que nadie apriete un botón.` },
          { t: 'h3', text: 'Por qué 5 % y por qué horas' },
          { t: 'p', html: `El porcentaje es un trade-off entre daño y velocidad para juntar evidencia. Con números de c01 (pico diurno ≈ 350 req/s, promedio ≈ 116 req/s):` },
          { t: 'calc', title: 'Requests del canary en una ventana de 10 minutos', rows: [
            { label: '1 % en el pico', expr: '350 × 0.01 × 600 s', value: '≈ 2,100' },
            { label: '5 % en el pico', expr: '350 × 0.05 × 600 s', value: '≈ 10,500' },
            { label: '5 % en el promedio', expr: '116 × 0.05 × 600 s', value: '≈ 3,500' },
            { label: '25 % en el pico', expr: '350 × 0.25 × 600 s', value: '≈ 52,500' },
          ], result: 'A 5 %, un modelo malo afecta a 1 de cada 20 requests, y en el pico juntas ≈ 10k requests cada 10 minutos.' },
          { t: 'p', html: `¿Alcanzan? Depende de qué quieras detectar. Con el estable recibiendo 19 veces más tráfico que el canary (95/5), α = 0.05 y potencia 0.8:` },
          { t: 'calc', title: 'Cuántos requests necesita el canary para ver un problema de 5xx', rows: [
            { label: '5xx sube de 0.1 % a 0.5 % (un bug grosero)', expr: 'test de dos proporciones, estable 19× más grande', value: '≈ 1,050 requests', note: '≈ 1 min en el pico al 5 %' },
            { label: '5xx sube de 0.1 % a 0.2 % (se duplica)', expr: 'ídem', value: '≈ 10,700 requests', note: '≈ 10 min en el pico, ≈ 31 min en el promedio' },
          ], result: 'Los problemas groseros saltan en minutos; los sutiles necesitan decenas de miles de requests. Por eso cada etapa dura horas y cubre al menos un pico: además del conteo, hay fallas que solo aparecen con el tiempo (una fuga de memoria, un cache que se llena) o con la carga (el p99 del pico).' },
          { t: 'callout', kind: 'why', title: 'Por qué no empezar en 1 % ni en 20 %', html: `<p>Con 1 %, en 10 minutos de pico hay ≈ 2,100 requests: un salto de 0.1 % a 0.2 % en 5xx serían ≈ 2 vs 4 errores, indistinguibles del azar; tendrías que esperar horas por etapa. Con 20 %, un modelo que rompe algo afecta a 1 de cada 5 requests antes de que salte la alarma. En un servicio con mucho más tráfico que c01, 1 % sí alcanza: el porcentaje se elige con el volumen, no por costumbre.</p>` },
          { t: 'h3', text: 'Criterios: para revertir y para avanzar' },
          { t: 'table', caption: 'Criterios de rollback automático de c01 (canary vs estable)', head: ['Señal', 'Umbral', 'Ventana'], rows: [
            ['5xx', '&gt; 0.5 % o &gt; 2× el estable', '10 min'],
            ['p99 de latencia', '&gt; 200 ms o &gt; 1.2× el estable', '10 min'],
            ['Tasa de baja confianza (top-1 &lt; 0.3)', '&gt; 1.5× el estable', '30 min'],
            ['Distribución de categorías predichas', 'PSI vs estable sobre ≈ 30 categorías padre &gt; 0.1, con ≥ 5,000 predicciones del canary en la ventana', '1 h'],
          ], note: 'Los de <a href="#c01.evaluacion">c01</a>. Umbrales de ejemplo: lo que importa es que sean automáticos, relativos al estable y con un n mínimo.' },
          { t: 'p', html: `Revertir es la mitad. Para <b>avanzar</b> de etapa también hace falta un criterio escrito, porque "nada se rompió en 20 minutos" no es evidencia si en 20 minutos pasaron 2,000 requests:` },
          { t: 'list', items: [
            'Todas las señales verdes durante toda la ventana, no solo al final.',
            'Un <b>n mínimo</b> del canary (por ejemplo, ≥ 10,000 requests por etapa) y un <b>tiempo mínimo</b> que incluya un pico diurno.',
            'Sin alertas de dependencias ni del cluster durante la etapa (si Triton del estable también tuvo problemas, la comparación no vale).',
            'Para el paso final a 100 %, una revisión humana corta: lo automático revierte, una persona promueve. Es una decisión de equipo, no de la herramienta.',
          ] },
          { t: 'callout', kind: 'trap', title: 'Comparar contra ayer en vez de contra el estable', html: `<p>Si el umbral es "5xx &gt; 0.3 %" a secas, un problema de la base de datos o un pico de tráfico hace fallar al canary aunque el modelo no tenga la culpa, y un canary malo en una hora tranquila pasa. Compara canary vs estable en la misma ventana: todo lo que les pasa a los dos se cancela y queda la diferencia que causó el cambio.</p>` },
          { t: 'h3', text: 'Por request o por usuario' },
          { t: 'table', head: ['Asignación', 'Cómo', 'Bien para', 'Problema'], rows: [
            ['Por request', 'Pesos en el balanceador: cada request cae en uno u otro', 'Salud operativa request por request (5xx, p99, baja confianza): el canary de c01', 'El mismo vendedor puede ver sugerencias de dos modelos en fotos de la misma publicación'],
            ['Por usuario (sticky)', 'Hash de un id estable (<code>seller_id</code>) → brazo, mandado en un header', 'Todo lo que mide comportamiento: el A/B de c01', 'Necesitas el id en el punto donde se enruta'],
            ['Sticky por cookie', 'Stickiness de target group del ALB (cookie <code>AWSALBTG</code>)', 'Navegadores', 'Un caller server-to-server como el backend de c01 normalmente no guarda cookies: no sirve'],
          ] },
          { t: 'p', html: `En c01 el canary reparte por request (mide salud) y el A/B por vendedor (mide comportamiento): el backend asigna el brazo con un hash del <code>seller_id</code>, lo manda en <code>X-Model-Arm</code> y una regla del listener del ALB con condición de header lo lleva a la release de su brazo (<a href="#c01.evaluacion">c01</a>).` },
          { t: 'h3', text: 'Herramientas' },
          { t: 'table', head: ['Herramienta', 'Qué hace', 'A tener en cuenta'], rows: [
            ['Argo Rollouts', 'CRD <code>Rollout</code> con pasos <code>setWeight</code>, <code>pause</code>, <code>analysis</code>; un <code>AnalysisTemplate</code> consulta Prometheus (o Datadog, HTTP, un Job) y aborta: el tráfico vuelve al estable', 'Sin <code>trafficRouting</code>, el peso se aproxima con el número de réplicas: con 2–4 pods de GPU no existe un 5 %. Con ALB (AWS Load Balancer Controller), Istio, NGINX o Gateway API, el peso es el del proxy'],
            ['Flagger', 'Canary, A/B (por header o cookie), blue/green y mirroring, con análisis por métricas; parte de la familia Flux, graduado en la CNCF', 'Necesita una malla (Istio, Linkerd, Kuma, Gateway API) o un ingress soportado (NGINX, Contour, Traefik…)'],
            ['SageMaker deployment guardrails', 'Blue/green con traffic shifting all at once, canary (dos pasos) o linear (n pasos), con <i>baking period</i> y rollback automático por alarmas de CloudWatch; también rolling', 'Solo endpoints en tiempo real y asíncronos, con exclusiones; las alarmas las defines tú'],
            ['KServe', '<code>canaryTrafficPercent</code> en el InferenceService; al promover, la revisión nueva recibe 100 %', 'Solo en el modo serverless (Knative); el análisis automático lo pones tú'],
            ['Vertex AI', 'Varios modelos en un endpoint con <code>trafficSplit</code> (porcentajes que suman 100)', 'El avance por etapas y el rollback los orquestas tú'],
            ['ALB con target groups ponderados', 'Pesos 0–999 por target group en una regla de forward', 'Si un target group queda vacío o sin targets sanos, el ALB <b>no</b> manda su parte al otro: esos requests fallan'],
          ], note: 'Estado verificado en la documentación de cada proyecto (sept. 2026). Revisa la versión que corre tu cluster: los campos cambian entre releases.' },
          { t: 'code', title: 'El canary de c01 con Argo Rollouts', caption: 'Solo el gateway es un Rollout: el Triton de la versión nueva (<code>triton-v2</code>) se despliega antes, sin tráfico, y los pods canary del gateway apuntan a él. Así se mantiene el par "gateway vN + Triton vN" de c01. El YAML se validó con PyYAML; las consultas usan las métricas del gateway de referencia de c01. El PSI no se calcula bien en PromQL: lo corre un job que publica el resultado (Argo también acepta un Job de Kubernetes como métrica).', files: [
            { name: 'rollout.yaml', lang: 'yaml', code: ROLLOUT },
            { name: 'analysis.yaml', lang: 'yaml', code: ANALYSIS, note: 'Decide qué pasa si una consulta no devuelve datos (un canary sin tráfico de noche). En la duda, que no avance.' },
          ] },
          { t: 'callout', kind: 'trap', title: 'El canary en GPU con pocas réplicas', html: `<p>Kubernetes solo reparte tráfico por pods. Si el estable tiene 2 pods de Triton y agregas 1 canary, el canary recibe ≈ 1/3 del tráfico, no 5 %. Con GPUs caras no vas a tener 20 réplicas para lograr 5 % por conteo. El porcentaje lo pone el proxy (ALB, malla, gateway), y el canary puede tener un solo pod siempre que aguante su parte con margen.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"The canary gets five percent of requests through ALB weights, which at our daytime peak is about ten thousand requests every ten minutes. It rolls back automatically if 5xx, p99, low-confidence rate or the prediction distribution get worse than the stable version in the same window. Each stage lasts hours and has to include a daily peak, and a person approves the last step to a hundred percent."</p>` },
        ],
      },

      // ======================================================== 4
      {
        id: 'blue-green',
        title: 'Blue/green y rollback instantáneo',
        titleEn: 'Blue/green deployments',
        priority: 'core',
        dims: ['tradeoffs', 'arquitectura'],
        blocks: [
          { t: 'p', html: `En <b>blue/green</b> hay dos entornos completos: <b>blue</b> sirve todo el tráfico y <b>green</b> tiene la versión nueva, arriba, caliente y probada, sin tráfico. El cambio es un solo switch del router (un Service, una regla del ALB, un alias) y volver es el mismo switch al revés. Mientras blue siga vivo, el rollback tarda segundos.` },
          { t: 'table', caption: 'Cuatro formas de cambiar de versión', head: ['Estrategia', 'Tráfico al nuevo', 'Rollback', 'Costo extra', 'Mide calidad'], rows: [
            ['Rolling update', 'Según pods reemplazados', 'Otro rollout (minutos, más con GPUs frías)', 'Casi nada (<code>maxSurge</code>)', 'No: solo readiness'],
            ['Blue/green', '0 % → 100 % de golpe (o por pasos, si la plataforma lo permite)', 'Un switch: segundos', 'Un entorno entero mientras dura el bake', 'Solo si agregas análisis después del switch'],
            ['Canary', '5 % → 25 % → 100 %', 'El peso vuelve al estable: segundos', 'Las réplicas del canary', 'Sí, contra el estable'],
            ['Shadow', 'Copia; nadie ve la respuesta', 'Nada que revertir', 'Inferencia doble sobre la muestra', 'Sí, pareado, pero sin usuarios'],
          ] },
          { t: 'p', html: `En la práctica se combinan. c01 hace un canary y, al promover, deja la release anterior (gateway + Triton) viva 24–48 h al mínimo: eso es un blue/green después del canary. El rollback en ese plazo es un cambio de ruteo; pasado el plazo, es redeployar la imagen anterior (${E('≈ 5–20 min')} por el cold start de nodos GPU) (<a href="#c01.fallas">fallas de c01</a>).` },
          { t: 'calc', title: 'Cuánto cuesta tener blue vivo en c01', rows: [
            { label: 'Release anterior al mínimo', expr: '1 × g4dn.xlarge', value: E('≈ US$0.526/h') },
            { label: 'Bake de 48 h', expr: '0.526 × 48', value: '≈ US$25' },
            { label: 'Bake de 96 h', expr: '0.526 × 96', value: '≈ US$50' },
          ], result: 'Contra un presupuesto de ≈ US$3k/mes, poder volver en segundos durante dos a cuatro días cuesta menos de un 2 %. Con un modelo que necesita 16 GPUs, el mismo bake vale una conversación con finanzas: ahí conviene un bake más corto o blue reducido al mínimo que aguante la carga mientras escala.' },
          { t: 'h3', text: 'Cuándo blue/green le gana al canary' },
          { t: 'list', items: [
            '<b>No pueden convivir dos versiones sobre tráfico mezclado</b>: el cambio de modelo viene con un cambio de esquema en la respuesta que los consumidores no toleran a medias, o con sesiones con estado.',
            '<b>El cambio tiene que ser atómico entre varias piezas</b>: modelo + mapa de labels + un consumidor que interpreta las salidas.',
            '<b>Predicciones batch</b>: el job escribe en <code>predictions_v2</code>, validas la tabla completa (conteos, distribución, muestra revisada) y cambias el puntero o la vista que leen los consumidores. Volver es mover el puntero.',
            '<b>Tráfico muy bajo</b>: un canary a 5 % de 2 req/s no junta evidencia en días. Mejor validar green con tráfico sintético o replay y cambiar todo con el rollback listo.',
          ] },
          { t: 'callout', kind: 'trap', title: 'Blue se apaga antes de lo que crees', html: `<p>En Argo Rollouts, la estrategia blue/green tiene <code>scaleDownDelaySeconds</code>, que por defecto es <b>30 segundos</b>: medio minuto después de promover, las réplicas de blue se reducen. Si tu plan de rollback es "volvemos a blue en segundos durante un día", súbelo y cuenta el costo. Del lado de SageMaker, blue se termina al acabar el baking period sin alarmas. Revisa siempre cuánto vive blue en la herramienta que uses.</p>` },
          { t: 'h3', text: 'Lo que blue y green comparten' },
          { t: 'p', html: `Dos entornos de cómputo no significan dos mundos. Blue y green leen la misma base de datos, el mismo feature store y los mismos caches, y escriben en los mismos logs. Ahí se rompe el "switch de vuelta":` },
          { t: 'table', head: ['Recurso compartido', 'Qué puede salir mal', 'Cómo se evita'], rows: [
            ['Esquema de la base de datos', 'Green migra una columna que blue necesita; al volver, blue falla', 'Migraciones compatibles hacia atrás en pasos (<a href="#m11.compatibilidad">expand and contract</a>)'],
            ['Features', 'Green necesita una feature nueva o una versión nueva de una existente', 'El pipeline publica la versión vieja y la nueva mientras blue pueda volver (<a href="#m09.feature-store">M9</a>)'],
            ['Prediction cache', 'Blue sirve respuestas que green cacheó (o al revés)', '<code>model_version</code> en la clave del cache'],
            ['Trabajo en curso', 'Mensajes en cola producidos por green que blue no entiende', 'Versionar el formato de los mensajes; drenar antes de cambiar'],
            ['Capacidad caliente', 'Green recibe el 100 % frío: modelos sin cargar, sin warmup, nodos GPU sin imagen', 'Green pasa readiness con warmup y se prueba con tráfico sintético antes del switch'],
          ] },
          { t: 'callout', kind: 'interview', html: `<p>"After promotion, the previous release stays up for a day or two, so rolling back is a routing change that takes seconds. That costs one extra GPU for that window, around twenty-five to fifty dollars per release here. Blue and green share the database and the feature store, so every schema change has to be backward compatible until blue is gone."</p>` },
        ],
      },

      // ======================================================== 5
      {
        id: 'ab-testing',
        title: 'A/B testing: unidad, métricas y tamaño de muestra',
        titleEn: 'A/B testing',
        priority: 'core',
        dims: ['monitoreo', 'estimaciones'],
        blocks: [
          { t: 'p', html: `El A/B test es el único peldaño que responde "¿mejora el producto?". Divides unidades al azar en dos brazos, cada uno ve un modelo, y comparas una métrica de producto. Al azar es la palabra clave: si los brazos solo difieren en el modelo, la diferencia en la métrica la causó el modelo. En la entrevista, un "haría un A/B" sin unidad, métrica, tamaño de muestra y duración vale casi nada. Con esas cuatro cosas, es de las partes que más suman.` },
          { t: 'h3', text: '1. La unidad de aleatorización' },
          { t: 'table', head: ['Unidad', 'Cuándo', 'Riesgo'], rows: [
            ['Usuario (vendedor, comprador)', 'Casi siempre: el usuario ve una experiencia coherente y su comportamiento se acumula', 'Las observaciones de un mismo usuario están correlacionadas: la varianza real es mayor'],
            ['Sesión o request', 'Cambios invisibles para el usuario (latencia, infraestructura)', 'El mismo usuario ve dos modelos: contamina todo lo que dependa de aprendizaje o consistencia'],
            ['Grupo (ciudad, mercado, tienda)', 'Hay interferencia entre usuarios (ver abajo)', 'Pocas unidades: poca potencia'],
            ['Tiempo (switchback)', 'Marketplaces con oferta y demanda compartidas: todo el mercado alterna entre A y B por bloques de tiempo', 'Efectos de arrastre entre bloques; análisis más delicado'],
          ] },
          { t: 'p', html: `En c01 la unidad es el <b>vendedor</b>: si se aleatorizara por request, un vendedor vería sugerencias de modelos distintos en fotos de la misma publicación. La asignación es un hash determinista, <code>hash(salt_del_experimento + seller_id) mod 100</code>. El <i>salt</i> cambia en cada experimento: sin él, los mismos vendedores caen siempre en el tratamiento y arrastran efectos de un experimento al siguiente.` },
          { t: 'h3', text: '2. Una métrica primaria y sus guardrails' },
          { t: 'p', html: `Antes de empezar se escribe <b>una</b> métrica primaria, la que decide. En c01 es la <b>tasa de aceptación</b> (el vendedor publica con una de las categorías sugeridas). Los <b>guardrails</b> no tienen que mejorar, pero no pueden empeorar: p99, tasa de error, porcentaje de publicaciones re-categorizadas después por moderadores (aceptar más una sugerencia equivocada sería una mejora falsa) y tiempo para completar el formulario. Las <b>secundarias</b> (tasa de publicaciones completadas) ayudan a entender, no deciden.` },
          { t: 'callout', kind: 'trap', title: 'Diez métricas y "alguna salió significativa"', html: `<p>Con α = 0.05 y diez métricas independientes sin efecto real, la probabilidad de que al menos una salga significativa por azar es 1 − 0.95<sup>10</sup> ≈ 40 %. Si decides con "la que mejoró", casi siempre ganas. Por eso la primaria se fija antes y las demás se leen con cuidado (o con una corrección por comparaciones múltiples).</p>` },
          { t: 'h3', text: '3. Tamaño de muestra, con los números de c01' },
          { t: 'p', html: `Línea base de aceptación ≈ 70 %. Quieres detectar una mejora de 1 punto porcentual (el MDE: el efecto más chico que vale la pena detectar). Aceptas 5 % de falsos positivos (α = 0.05, bilateral) y quieres encontrar el efecto el 80 % de las veces si existe (potencia 0.8):` },
          { t: 'calc', title: 'n por brazo para 70 % → 71 %', rows: [
            { label: 'Varianza de una proporción', expr: 'p(1 − p) = 0.70 × 0.30', value: '0.21' },
            { label: 'MDE al cuadrado', expr: 'δ² = 0.01²', value: '0.0001' },
            { label: 'Factor de α y potencia', expr: '(z<sub>0.975</sub> + z<sub>0.8</sub>)² = (1.96 + 0.84)²', value: '≈ 7.85' },
            { label: 'Regla práctica', expr: '2 × 7.85 × 0.21 ÷ 0.0001 ≈ 16 × 0.21 ÷ 0.0001', value: '≈ 33,600' },
            { label: 'Fórmula completa de dos proporciones', expr: 'ver abajo', value: '≈ 32,650' },
          ], result: '<b>≈ 33k publicaciones por brazo</b>, el mismo número de <a href="#c01.evaluacion">c01</a>. Con ≈ 2.5 M publicaciones al día se junta en menos de una hora al 50/50, y en ≈ 6 h con 5 % en tratamiento.' },
          { t: 'p', html: `Ahora la fórmula. Con p<sub>1</sub> = 0.70, p<sub>2</sub> = 0.71, p̄ = 0.705 y δ = p<sub>2</sub> − p<sub>1</sub>:<br><code>n = [ z<sub>1−α/2</sub> · √(2 p̄ (1 − p̄)) + z<sub>1−β</sub> · √(p<sub>1</sub>(1 − p<sub>1</sub>) + p<sub>2</sub>(1 − p<sub>2</sub>)) ]² ÷ δ²</code><br>La regla práctica <code>n ≈ 16 · p(1 − p) ÷ δ²</code> sale de reemplazar las dos varianzas por la de la línea base; para proporciones lejos de 0 y 1 queda a pocos puntos porcentuales de la exacta (<a href="#ref-numeros.formulas">fórmulas</a>).` },
          { t: 'table', caption: 'Lo que importa de la fórmula: n crece con 1/δ²', head: ['MDE sobre 70 %', 'n por brazo', 'Relación'], rows: [
            ['2 pp', '≈ 8,100', '¼ de la muestra'],
            ['1 pp', '≈ 32,650', 'referencia'],
            ['0.5 pp', '≈ 131,200', '4× la muestra'],
          ] },
          { t: 'code', title: 'Tamaño de muestra y chequeo de SRM en Python', caption: 'Corrió tal cual con Python 3.13 y solo la librería estándar. La función sirve para una proporción; para métricas continuas (tiempo de formulario) se usa la varianza de la métrica.', files: [
            { name: 'ab.py', lang: 'python', code: AB_PY },
          ] },
          { t: 'callout', kind: 'senior', title: 'La unidad es el vendedor, la métrica es por publicación', html: `<p>El cálculo de arriba supone publicaciones independientes, pero un vendedor que publica tres veces tiene aceptaciones correlacionadas. El <i>design effect</i> lo cuantifica: <code>1 + (m − 1) · ρ</code>, con m publicaciones por vendedor y ρ la correlación dentro del vendedor. Con m = 3 y ρ = ${E('0.2')}, el factor es 1.4: hacen falta ≈ 45,700 publicaciones por brazo para la misma potencia. La varianza se calcula agrupando por vendedor (delta method o errores agrupados). Decir "the randomization unit is the seller, so I compute the variance at the seller level" es señal senior.</p>` },
          { t: 'h3', text: '4. Duración: semanas, aunque la muestra se junte en horas' },
          { t: 'list', items: [
            '<b>Estacionalidad semanal</b>: el vendedor del domingo no es el del martes. Corre semanas completas (7 o 14 días), no "hasta llegar a n".',
            '<b>Efecto novedad</b>: un cambio visible altera el comportamiento los primeros días (curiosidad o rechazo) y después se acomoda. Mira la métrica por día desde el inicio: si el efecto se achica día a día, espera.',
            '<b>Métricas que tardan</b>: la re-categorización por moderadores llega días después; un guardrail que llega tarde necesita que el experimento dure lo suficiente para verlo.',
          ] },
          { t: 'h3', text: 'Peeking y tests secuenciales' },
          { t: 'p', html: `El error clásico: mirar el resultado cada día y parar cuando "ya es significativo". Lo simulamos: 20,000 A/A tests (los dos brazos idénticos, 70 %), 2,400 unidades por brazo y por día, 14 días. Con un solo análisis al final, 5 % sale significativo, como debe. Si miras cada día y paras en la primera vez que p &lt; 0.05, <b>21.5 %</b> de los experimentos "encuentran" un efecto que no existe.` },
          { t: 'p', html: `Dos salidas. La simple: fija la duración antes y no decidas antes de tiempo (puedes mirar los guardrails para detener un daño, no para declarar victoria). La flexible: un <b>test secuencial</b>, diseñado para mirar muchas veces sin inflar el error: diseños de grupo secuencial con <i>alpha spending</i>, o p-values e intervalos "siempre válidos" (mSPRT, confidence sequences). Varias plataformas de experimentación ofrecen alguna variante; verifica cuál implementa la tuya antes de decir que "puedes mirar cuando quieras". El precio: para el mismo efecto, suelen necesitar más muestra que un test fijo si llegas al final.` },
          { t: 'h3', text: 'Sample ratio mismatch: el chequeo que va primero' },
          { t: 'p', html: `Si configuraste 50/50 y llegaron 50,600 publicaciones a un brazo y 49,400 al otro, ¿es azar? Chi-cuadrado: χ² = 14.4, p ≈ 0.00015. No es azar: algo quita o agrega unidades en un brazo, y <b>no se lee el resultado</b> hasta entenderlo. Con 50,150 vs 49,850, p ≈ 0.34: normal. Causas típicas: el brazo nuevo es más lento y más requests caen en timeout antes de loguearse, un filtro de bots que se comporta distinto en cada brazo, un bug en la asignación, o el logging de una release que pierde eventos. Un SRM casi nunca es "mala suerte" y casi siempre sesga la métrica.` },
          { t: 'h3', text: 'Interferencia: cuando los brazos no son independientes' },
          { t: 'p', html: `El A/B supone que lo que ve un usuario no afecta a otro. En marketplaces, redes sociales y logística eso se rompe: si el ranking del tratamiento manda más compradores a ciertos vendedores, se los quita al control; si el modelo de precios baja precios en el tratamiento, el control pierde ventas. El resultado exagera el efecto. Las salidas son aleatorizar por grupo (ciudad, mercado) o por tiempo (switchback), a costa de potencia. En c01 la interferencia es chica (la sugerencia afecta a la publicación de ese vendedor), pero hay un recurso compartido: la cola de moderadores. Por eso la re-categorización es guardrail y no métrica primaria.` },
          { t: 'callout', kind: 'skip', html: `<p>CUPED (reducir varianza usando la métrica de cada unidad antes del experimento; Deng et al., 2013), la matemática del mSPRT y los estimadores para switchbacks rara vez se preguntan en una ronda de MLE. Basta con nombrarlos si el entrevistador pregunta cómo acortarías el experimento o cómo mirarías antes. El tamaño de muestra, la unidad, SRM y peeking sí se preguntan. Para profundizar: Kohavi, Tang y Xu, <i>Trustworthy Online Controlled Experiments</i> (2020).</p>` },
          { t: 'h3', text: 'Cuando no hay A/B clásico: c02 y c03' },
          { t: 'table', head: ['Caso', 'Por qué no', 'Qué hace en su lugar'], rows: [
            ['<a href="#c02.evaluacion">c02</a> video', 'No puedes dejar cámaras sin alertas como control; las cámaras no son intercambiables (perímetro vs pasillo, día vs noche); lo que un modelo no detecta no aparece en ninguna métrica online', 'Shadow pareado sobre los mismos frames, replay de clips etiquetados, canary de sitios contra su propia semana anterior y walk tests. Si insisten: aleatorizar por cámara dentro de cada sitio solo para falsas alarmas'],
            ['<a href="#c03.evaluacion">c03</a> inspección', 'No hay usuarios que reaccionen; no vas a inspeccionar la mitad de las piezas con un modelo peor; los escapes llegan semanas después desde la armadora', 'Shadow de un turno con revisión de cada desacuerdo, piezas patrón defectuosas, una línea decidiendo (canary) y antes/después por línea'],
          ] },
          { t: 'p', html: `El patrón general: cuando las unidades son pocas y distintas, o el error es caro, cambias <b>aleatorización</b> por <b>comparación pareada</b> (los dos modelos sobre el mismo input) y por <b>verdad conocida</b> sembrada a propósito (walk tests, piezas patrón).` },
          { t: 'callout', kind: 'senior', title: 'El holdout de largo plazo', html: `<p>El A/B mide dos semanas. Para efectos acumulados (un feedback loop que degrada los labels, un cambio de hábito), se deja un <b>holdout</b> chico por meses. c01 ya lo tiene por otra razón: ≈ 1 % de vendedores sin sugerencias, que da labels no contaminados y mide el valor total de la función (<a href="#c01.datos">datos de c01</a>).</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"The A/B test randomizes by seller with a salted hash, and the primary metric is acceptance rate, with p99, error rate, moderator re-categorization and form time as guardrails. To detect one point over a seventy percent baseline at alpha 0.05 and eighty percent power, we need about thirty-three thousand listings per arm, more once we account for sellers with several listings. We get that in hours, but we run two full weeks for weekly seasonality and novelty, we don't stop early, and we check for sample ratio mismatch before reading anything."</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'interleaving-bandits',
        title: 'Interleaving y bandits: cuándo valen la pena',
        titleEn: 'Interleaving and multi-armed bandits',
        priority: 'extra',
        dims: ['tradeoffs'],
        blocks: [
          { t: 'p', html: `Dos alternativas al A/B que aparecen en entrevistas de recomendación y ranking. Ninguna reemplaza al A/B en general; cada una gana en un caso concreto.` },
          { t: 'h3', text: 'Interleaving: comparar dos rankers en la misma lista' },
          { t: 'p', html: `En vez de mostrar la lista de A a unos usuarios y la de B a otros, a <b>cada usuario</b> le muestras una lista que mezcla las dos. En <i>team-draft interleaving</i>, A y B se turnan (quién elige primero se sortea en cada ronda) para aportar su mejor ítem que aún no está en la lista; cada clic o reproducción se acredita al ranker que aportó ese ítem. Gana el que junta más créditos.` },
          { t: 'p', html: `¿Por qué es mucho más sensible? Porque la comparación es <b>dentro del mismo usuario</b>: un usuario que hace muchos clics y uno que casi no hace ninguno ya no agregan ruido entre brazos, y el sorteo reparte las posiciones buenas por igual. Netflix reportó en su blog de tecnología (2017) que, en su caso, interleaving necesitaba más de 100 veces menos usuarios que su métrica de A/B más sensible para identificar el mejor ranker, y que sus resultados estaban fuertemente correlacionados con sus métricas de A/B.` },
          { t: 'table', head: ['Interleaving sirve para', 'No sirve para'], rows: [
            ['Elegir entre dos rankers o recomendadores', 'Medir un efecto absoluto en el negocio (ingresos, retención): solo da una preferencia'],
            ['Filtrar rápido muchos candidatos antes de un A/B', 'Cambios que no son una lista ordenada'],
            ['Tráfico escaso frente al efecto que buscas', 'Latencia o costo: cada request corre los dos rankers'],
          ] },
          { t: 'p', html: `El flujo típico es interleaving para descartar candidatos en días y A/B para el finalista (<a href="#c08">caso de recomendación</a>). ¿Y c01? Su top-5 es técnicamente una lista ordenada, así que podrías intercalar, pero junta 33k publicaciones por brazo en horas: el A/B no es su cuello de botella.` },
          { t: 'h3', text: 'Multi-armed bandits: explorar y explotar a la vez' },
          { t: 'p', html: `Un A/B reparte 50/50 hasta el final aunque a mitad de camino un brazo ya se vea peor. Un <b>bandit</b> va moviendo tráfico hacia el brazo que rinde mejor mientras sigue explorando un poco los otros. Las estrategias clásicas son epsilon-greedy (un porcentaje fijo explora al azar), UCB (prefiere el brazo con el mejor límite optimista) y Thompson sampling (asigna según la probabilidad de que cada brazo sea el mejor). Lo que se paga en un A/B por explorar se llama <b>regret</b>: la recompensa que perdiste mostrando el brazo peor.` },
          { t: 'calc', title: 'El regret de un A/B en c01', rows: [
            { label: 'Publicaciones en el brazo peor', expr: 'n por brazo', value: '≈ 33,000' },
            { label: 'Diferencia de aceptación', expr: '1 pp', value: '0.01' },
            { label: 'Aceptaciones perdidas', expr: '33,000 × 0.01', value: '≈ 330' },
          ], result: '330 publicaciones que usaron el selector manual en vez de aceptar una sugerencia. No justifica la complejidad de un bandit: en c01 se queda el A/B.' },
          { t: 'table', caption: 'A/B vs bandit', head: ['Aspecto', 'A/B test', 'Bandit'], rows: [
            ['Objetivo', 'Aprender la verdad para una decisión que dura', 'Maximizar la recompensa mientras aprendes'],
            ['Reparto del tráfico', 'Fijo', 'Cambia con los resultados'],
            ['Inferencia', 'Intervalos y tests limpios', 'Estimaciones sesgadas por el reparto adaptativo; los intervalos son más difíciles'],
            ['Brazos', '2–4', 'Muchos (titulares, miniaturas, creatividades)'],
            ['Vida de lo que se prueba', 'Larga (un modelo por meses)', 'Corta (una promo de una semana, una noticia de hoy)'],
            ['Recompensa', 'Puede llegar tarde; la esperas', 'Tiene que llegar rápido para reasignar'],
            ['Guardrails', 'Explícitos', 'Fáciles de olvidar: el bandit solo optimiza su recompensa'],
          ] },
          { t: 'p', html: `Cuándo sí: muchas variantes, horizonte corto, recompensa inmediata y costo de explorar alto frente al de esperar. El ejemplo típico es elegir la miniatura o el titular de algo que solo vive días. Cuándo no: decisiones que importan a largo plazo, recompensas que tardan semanas (los escapes de <a href="#c03">c03</a> harían imposible un bandit) o cuando necesitas un número defendible del efecto. Los <b>contextual bandits</b> eligen el brazo según features del usuario; en la práctica, eso ya es un sistema de recomendación con exploración.` },
          { t: 'callout', kind: 'skip', html: `<p>Cotas de regret, la posterior Beta de Thompson sampling, los estimadores para bandits y los detalles de <i>team-draft</i> vs <i>balanced interleaving</i> no los vas a necesitar salvo en una entrevista de ranking con alguien del área. Basta con saber qué pregunta responde cada uno y cuándo lo elegirías.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"For two rankers I'd interleave first: every user sees a mixed list, so the comparison is within the same user and needs far less traffic, and it only tells me which ranker users prefer. The finalist then goes to an A/B test for the business metric. I'd use a bandit only when there are many short-lived variants and the reward comes back right away."</p>` },
        ],
      },

      // ======================================================== 7
      {
        id: 'compatibilidad',
        title: 'Feature flags y compatibilidad entre versiones',
        titleEn: 'Feature flags and version compatibility',
        priority: 'core',
        dims: ['arquitectura', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Durante cualquier despliegue seguro hay <b>dos versiones vivas a la vez</b>: el shadow, el canary, los brazos del A/B, blue y green, las olas de una flota. Todo lo que rodea al modelo (callers, caches, logs, features, consumidores) tiene que funcionar con las dos. Esa es la parte que los candidatos olvidan, y la que rompe despliegues que "pasaron el canary".` },
          { t: 'h3', text: 'Feature flags: separar desplegar de activar' },
          { t: 'p', html: `Un <b>feature flag</b> es una condición en el código que se evalúa en tiempo de ejecución contra una configuración remota: "¿este vendedor ve sugerencias?", "¿este request usa el modelo v2?". Desplegar el código y activar el comportamiento quedan separados: el código nuevo llega apagado y se enciende para un porcentaje, un segmento o un equipo interno. El MVP de c01 es exactamente eso: la sugerencia visible para el 10 % de los vendedores (<a href="#c01.arquitectura">arquitectura de c01</a>).` },
          { t: 'list', items: [
            '<b>Kill switch</b>: un flag que apaga la función entera (en c01, volver al selector manual para todos) sin desplegar nada. Es el rollback más rápido que existe, y el único que sirve si el problema no es el modelo sino la función.',
            '<b>El flag se evalúa en el servidor</b> (backend o gateway) y su valor se loguea con cada predicción; si no, no puedes separar después qué vio cada usuario.',
            '<b>Herramientas</b>: LaunchDarkly, Unleash, Flagsmith, AWS AppConfig, o las de tu plataforma de experimentos. OpenFeature es un estándar abierto de API y SDKs para flags (proyecto en incubación de la CNCF) que evita atar el código a un proveedor.',
            '<b>Deuda</b>: cada flag es una rama de código. Un flag que ya está al 100 % hace meses se borra; si no, en un año nadie sabe qué combinación corre en producción.',
          ] },
          { t: 'callout', kind: 'trap', title: 'Flags para asignar brazos de un A/B', html: `<p>Un flag de porcentaje sirve para un rollout, pero no siempre para un experimento: si el flag asigna por request, o re-sortea cuando cambias el porcentaje de 10 % a 20 %, los usuarios cambian de brazo a mitad del experimento. Para un A/B, la asignación tiene que ser estable por usuario (hash con salt) y quedar registrada.</p>` },
          { t: 'h3', text: 'Los tres contratos de un modelo en producción' },
          { t: 'table', head: ['Contrato', 'Qué incluye en c01', 'Cambio compatible', 'Cambio que rompe'], rows: [
            ['API pública', '<code>POST /v1/classify?top_k=5</code> → <code>model_version</code>, <code>predictions[{label, score}]</code>, <code>latency_ms</code>', 'Agregar un campo opcional a la respuesta', 'Renombrar o quitar campos; cambiar lo que significa <code>score</code> (por ejemplo, calibrarlo) sin avisar; cambiar el default de <code>top_k</code>'],
            ['Entrada del modelo', 'Tensor <code>input</code> FP32 <code>[3,224,224]</code> + la versión del preprocesamiento', '—', 'Otro tamaño, otra normalización, otro orden de canales: el modelo responde, pero mal (skew, <a href="#m09.skew">M9</a>)'],
            ['Salida del modelo', '<code>logits</code> FP32 <code>[500]</code> + <code>labels.json</code> con su hash', '—', 'Otra cantidad u otro orden de labels: la posición 17 ahora es otra categoría'],
          ] },
          { t: 'p', html: `El tercero es el más peligroso porque falla en silencio: cada request responde 200 con scores normales, pero con el nombre de otra categoría. c01 lo resuelve haciendo que <code>labels.json</code> viaje <b>con</b> el modelo (mismo artefacto en el registry, con su hash) y que el gateway verifique al arrancar y en la readiness que su versión coincide con <code>MODEL_VERSION</code> y que hay 500 labels, igual que la dimensión de <code>logits</code> (<a href="#c01.fallas">fallas de c01</a>). Y la API devuelve el <b>nombre o un id estable</b> de la categoría, nunca la posición en el vector.` },
          { t: 'h3', text: 'Cambios que rompen, en pasos que no rompen' },
          { t: 'p', html: `El patrón es <b>expand and contract</b> (<i>parallel change</i>): primero todos aprenden a aceptar lo nuevo, después se empieza a producir lo nuevo, y al final se deja de soportar lo viejo. Ejemplo: c01 pasa de 500 a 501 categorías.` },
          { t: 'steps', items: [
            { title: 'Expandir los consumidores', html: 'Moderación y búsqueda (que también llaman la API) aprenden a recibir la categoría nueva: su taxonomía la conoce antes de que el modelo la sugiera.' },
            { title: 'Publicar modelo y labels juntos', html: 'Una versión nueva del registry con 501 salidas y su <code>labels.json</code>. La release nueva es un par gateway + Triton propio: nunca un gateway viejo con un modelo nuevo.' },
            { title: 'Convivir', html: 'Shadow y canary: la mitad del sistema devuelve 500 categorías posibles y la otra 501. Los logs llevan <code>model_version</code>; los dashboards por categoría se leen por versión.' },
            { title: 'Contraer', html: 'Con el modelo nuevo al 100 % y el bake terminado, se retira la release vieja. Solo entonces se borra lo que quedó por compatibilidad.' },
          ] },
          { t: 'h3', text: 'Dos versiones vivas: lo que tiene que saberlo' },
          { t: 'table', head: ['Pieza', 'Qué hacer'], rows: [
            ['Logs y métricas', '<code>model_version</code> y brazo en cada línea y como etiqueta de métrica (en c01, <code>classifier_requests_total</code> y <code>classifier_top1_score</code> ya la tienen)'],
            ['Prediction cache', 'La versión del modelo es parte de la clave'],
            ['Features', 'Si v2 usa otra versión de una feature, el feature store sirve las dos mientras v1 viva (<a href="#m09.feature-store">M9</a>)'],
            ['Datos para reentrenar', 'Qué modelo produjo lo que el usuario vio: sin eso, el feedback loop se vuelve imposible de separar'],
            ['Embeddings', 'Los vectores de dos modelos distintos no se comparan: cambiar el modelo de embeddings obliga a reindexar todo, no a mezclar índices'],
          ] },
          { t: 'h3', text: 'Clientes fijados a una versión' },
          { t: 'p', html: `A veces un consumidor necesita quedarse en una versión: un job batch que compara resultados mes a mes, un equipo que certificó su flujo con el modelo actual. Se resuelve exponiendo la versión explícita (Triton acepta <code>/v2/models/classifier/versions/N/infer</code> con una <code>version_policy</code> que deje cargadas las dos, <a href="#m07.triton">M7</a>) o con una release vieja viva con fecha de retiro. En el edge es la regla, no la excepción: durante las olas de <a href="#c02">c02</a> hay sitios en la versión vieja y en la nueva durante semanas, así que la API de eventos y el verificador de la nube tienen que aceptar eventos de los dos detectores (cada evento trae su <code>model_version</code>).` },
          { t: 'callout', kind: 'interview', html: `<p>"During every rollout two model versions are live, so everything around them has to handle both: model version in every log line and in the cache key, both feature versions in the store, and labels shipped inside the model artifact so the gateway can check them at startup. Breaking changes go expand and contract: consumers learn the new format first, then the model starts producing it, and the old path goes away last."</p>` },
        ],
      },

      // ======================================================== 8
      {
        id: 'rollback',
        title: 'Rollback: criterios automáticos y qué guardar para volver',
        titleEn: 'Automated rollback',
        priority: 'core',
        dims: ['monitoreo'],
        blocks: [
          { t: 'p', html: `La regla operativa: <b>primero revertir, después investigar</b>. Un rollback conocido y ensayado cuesta minutos; depurar con usuarios afectados cuesta horas y errores. Por eso los criterios se escriben antes del despliegue y se ejecutan solos.` },
          { t: 'table', caption: 'Criterios de rollback automático (ajusta los números a tu varianza)', head: ['Señal', 'Umbral de ejemplo', 'Ventana', 'Por qué esa'], rows: [
            ['5xx del canary', '&gt; 0.5 % o &gt; 2× el estable', '10 min', 'El fallo más obvio; se ve en minutos'],
            ['p99', '&gt; SLO o &gt; 1.2× el estable', '10 min', 'Un modelo más pesado rompe el presupuesto en el pico'],
            ['Timeouts y fallbacks', 'Tasa de 504 o de fallback &gt; 2× el estable', '10 min', 'El usuario ve el fallback aunque el servicio "responda"'],
            ['Salidas inválidas', 'NaN, vacías o fuera de rango &gt; 0', '5 min', 'Un engine roto devuelve basura con código 200'],
            ['Baja confianza', '&gt; 1.5× el estable', '30 min', 'Señal de calidad sin labels'],
            ['Distribución de predicciones', 'PSI &gt; 0.1 con un n mínimo', '1 h', 'Un modelo que "se fue" hacia algunas clases'],
            ['Proxy de negocio rápido', 'Aceptación por hora del canary &lt; estable − X pp, con n mínimo', '2–4 h', 'Solo para caídas grandes; las chicas son del A/B'],
            ['Recursos', 'Reinicios, OOMKilled, memoria de GPU creciendo', '15 min', 'Fugas que no fallan al principio'],
          ] },
          { t: 'callout', kind: 'trap', title: 'Un rollback automático con ruido', html: `<p>Un criterio que dispara por azar de noche entrena al equipo a ignorarlo. El PSI sobre 500 categorías tiene un piso de ruido que depende de n: en c01, ≈ 0.07 con 7,200 predicciones por hora y ≈ 0.14 con 3,600 (<a href="#c01.evaluacion">c01</a>). Si el umbral es 0.1 sin n mínimo, el canary se revierte de madrugada sin que nada esté mal. Agrupa (categorías padre), exige un n mínimo y compara contra el estable en la misma ventana.</p>` },
          { t: 'h3', text: 'Qué tienes que guardar para volver rápido' },
          { t: 'list', items: [
            '<b>La imagen anterior por digest</b>, no por tag: un tag móvil puede apuntar a otra cosa mañana (<a href="#m05.registries">M5</a>). En c01 la imagen de Triton trae el engine horneado: volver a la imagen es volver al modelo.',
            '<b>El engine anterior</b>, construido para el mismo hardware: un engine de TensorRT no es portable, así que no puedes "reconstruirlo rápido" en un incidente (<a href="#m08.tensorrt">M8</a>).',
            '<b>La configuración anterior</b>: umbrales, top-k y <code>labels.json</code>, versionados con el modelo.',
            '<b>La release anterior viva</b> durante el bake (24–48 h en c01): convierte el rollback en un cambio de ruteo.',
            '<b>Las features que usaba</b>: si el modelo nuevo necesitó una versión nueva de una feature, la vieja sigue publicándose hasta que termine el bake.',
            '<b>El historial del registry</b>: qué versión fue champion y cuándo. Volver es mover el alias <code>champion</code> a la versión anterior (<a href="#m10.model-registry">M10</a>) y desplegar su artefacto, que sigue guardado.',
          ] },
          { t: 'h3', text: 'Revertir un modelo es fácil; revertir datos, no' },
          { t: 'table', head: ['Qué cambió', 'Cómo se revierte', 'Qué tan rápido', 'Lo difícil'], rows: [
            ['Modelo (engine, pesos)', 'Peso al estable, alias al anterior, imagen anterior', 'Segundos a minutos', 'Casi nada, si guardaste lo de arriba'],
            ['Configuración (umbral, top-k)', 'Revertir el cambio en git o en el flag', 'Minutos', 'Que esté versionada y no editada a mano'],
            ['Pipeline de features', 'Volver al código anterior', 'Minutos para lo nuevo', 'Los valores malos ya escritos en el online store siguen ahí: hay que recalcularlos (backfill) y un modelo viejo los lee igual'],
            ['Datos de entrenamiento', 'Reentrenar sin los datos malos', 'Días', 'Saber qué snapshot los incluyó y qué modelos entrenaron con ellos (linaje, <a href="#m09.versionado">M9</a>)'],
            ['Labels generados por el modelo malo', 'Excluir por <code>model_version</code>', 'Días', 'Si no guardaste qué modelo produjo cada predicción, no puedes separarlos'],
          ] },
          { t: 'callout', kind: 'why', html: `<p>Un rollback de modelo funciona porque el modelo es un artefacto inmutable y el cambio es un puntero. Los datos no son un puntero: son estado que otros ya leyeron. Por eso los cambios de features y de datos se despliegan con el mismo cuidado que un modelo (versión nueva en paralelo, comparación, cambio de puntero), y nunca "en caliente" sobre la tabla que sirve producción.</p>` },
          { t: 'h3', text: 'El runbook' },
          { t: 'steps', items: [
            { title: 'Detectar', meta: 'automático', html: 'Una alerta o el análisis del canary dispara. Si el rollback no fue automático, la alerta trae el link al runbook y al dashboard de canary vs estable.' },
            { title: 'Revertir sin diagnosticar', meta: '≤ 5 min', html: 'Peso al estable, alias al anterior, symlink a la versión anterior en el edge. La pregunta no es "¿por qué?" sino "¿empezó con el deploy?". Si coincide, se revierte.' },
            { title: 'Confirmar', meta: '15–30 min', html: 'Las métricas vuelven a su nivel. Si no vuelven, el deploy no era la causa: se abre un incidente normal.' },
            { title: 'Congelar', html: 'Se pausa la promoción automática y el reentrenamiento programado que usa los mismos datos, para que el mismo problema no vuelva a subir solo.' },
            { title: 'Comunicar', html: 'Un mensaje corto al canal del equipo y a los dueños de los callers: qué versión, cuánto tiempo, qué porcentaje afectado.' },
            { title: 'Investigar y postmortem', html: 'Con calma: qué señal lo atrapó, cuál debió atraparlo antes y qué criterio se agrega al gate o al canary.' },
          ] },
          { t: 'h3', text: 'Rollback en el edge' },
          { t: 'p', html: `En una flota no hay un balanceador que mueva el tráfico: cada dispositivo tiene que poder volver solo. <b>c02</b> guarda cada versión en <code>/opt/c02/models/&lt;versión&gt;</code>; un symlink <code>current</code> elige cuál corre. Volver es apuntar el symlink a la anterior (que sigue en disco), poner su <code>MODEL_VERSION</code> y <code>docker compose up -d</code>. Si durante una ola un sitio empeora contra su semana anterior, la ola se detiene y ese sitio vuelve (<a href="#c02.arquitectura">c02</a>). <b>c03</b> guarda dos engines en cada Jetson (actual y anterior): el rollback es local, tarda minutos y no depende de la nube, algo obligatorio en una línea que debe operar 72 h sin conexión (<a href="#c03.evaluacion">c03</a>).` },
          { t: 'callout', kind: 'senior', html: `<p>Una mejora que puedes proponer para el edge: un <b>watchdog local</b> que revierte solo si la versión nueva no pasa su health check N veces seguidas después de arrancar (crash loop, engine que no carga). Así un sitio sin uplink no queda ciego esperando que alguien lo alcance. Y un rollback que nunca se ensayó no es un plan: se practica en staging, o en un sitio canary, antes de necesitarlo.</p>` },
          { t: 'followups', items: [
            { q: 'El canary lleva 3 horas al 5 % y todo está verde. ¿Lo pasas a 100 %?',
              junior: 'Sí, si todo está verde el modelo está bien.',
              senior: 'A 25 % primero, no a 100 %. Y reviso que el verde tenga evidencia: ¿cuántos requests juntó el canary? ¿cubrió un pico? A 5 % con el tráfico promedio son ≈ 3,500 requests cada 10 minutos, suficiente para errores groseros pero no para un aumento chico de 5xx. El paso final lo aprueba una persona después de un pico diurno, y la release anterior queda viva 24–48 h.',
              why: 'Distingue "no vi problemas" de "tuve la muestra para verlos", y no se salta la etapa intermedia.' },
            { q: 'Promoviste ayer. Hoy la tasa de aceptación bajó 2 pp. ¿Qué haces?',
              junior: 'Investigo qué pasó con el modelo para entender la causa.',
              senior: 'Primero reviso si coincide con el deploy (y no con un cambio del caller o del producto). Si coincide, vuelvo: la release anterior sigue viva por el bake, así que es un cambio de ruteo de segundos. Confirmo que la aceptación vuelve. Después investigo sin presión: slices, desacuerdos del shadow que no revisamos, latencia en el pico. Y agrego al canary la señal que lo hubiera atrapado.',
              why: 'Mitigar antes de diagnosticar, con un rollback preparado de antemano.' },
            { q: '¿Cómo haces rollback si lo que cambió fue el pipeline de features, no el modelo?',
              junior: 'Vuelvo al modelo anterior.',
              senior: 'El modelo anterior lee las mismas features malas, así que no alcanza. Revierto el código del pipeline, recalculo los valores afectados en el online store (backfill del tramo con el bug) y, si los datos malos llegaron a un snapshot, marco qué modelos entrenaron con él. Para la próxima: los cambios de features salen como versión nueva en paralelo y el modelo cambia de versión de feature con su propio canary.',
              why: 'Entiende que los datos son estado y no un puntero, y cambia el proceso para que no se repita.' },
            { q: '¿Por qué no dejas que el canary pase solo a 100 % si todas las métricas están bien?',
              junior: 'Porque siempre es mejor que un humano revise.',
              senior: 'Lo automático es bueno para revertir: un criterio roto es una señal clara. Promover es otra cosa: las métricas del canary no ven el negocio ni efectos lentos. Automatizo las etapas intermedias y dejo el último paso con aprobación, que es barato. Con muchos modelos y releases diarias, automatizaría también la promoción, pero con un bake largo y el A/B para los cambios grandes.',
              why: 'Argumenta la asimetría entre revertir y promover y dice cuándo cambiaría de opinión.' },
            { q: 'Una ola de OTA en c02 falla en uno de los 10 sitios. ¿Detienes todo?',
              junior: 'No, 9 de 10 funcionan: sigo con la ola.',
              senior: 'Detengo la ola (no reviertes los 9, pero no sumas sitios) y ese sitio vuelve al symlink anterior. Después miro qué tiene de distinto: tipo de cámara, IR de noche, una escena que no estaba en los slices. Si es un slice que el gate no cubría, se agrega y la ola se retoma con la versión corregida.',
              why: 'Para el rollout en el primer síntoma y convierte la falla en un slice nuevo del gate.' },
            { q: '¿Qué guardas para que el rollback de c03 funcione sin internet?',
              junior: 'El modelo anterior en la nube, para bajarlo si hace falta.',
              senior: 'El engine anterior en el mismo Jetson, construido para su JetPack exacto, con sus umbrales. Volver es local y tarda minutos. La planta debe operar 72 h sin conexión, así que nada del rollback puede depender de la nube ni de la DMZ.',
              why: 'Conecta el rollback con los requisitos de disponibilidad del edge.' },
          ] },
        ],
      },

      // ======================================================== 9
      {
        id: 'offline-online',
        title: 'La brecha offline–online: por qué las métricas no coinciden',
        titleEn: 'The offline–online gap',
        priority: 'core',
        dims: ['monitoreo', 'aclaracion'],
        blocks: [
          { t: 'p', html: `Pasa en todos los equipos: el modelo gana offline y el A/B sale plano, o peor. No es mala suerte: la métrica offline y la online miden cosas distintas sobre datos distintos. El candidato senior lo sabe y lo anticipa en su diseño.` },
          { t: 'h3', text: 'Un ejemplo concreto (inventado, con los números de c01)' },
          { t: 'p', html: `El challenger gana 1.5 pp de top-5 en el golden set. El A/B de dos semanas da −0.4 pp de aceptación. El diagnóstico, pieza por pieza:` },
          { t: 'table', head: ['Hallazgo', 'Qué pasó', 'Qué lo hubiera anticipado'], rows: [
            ['La ganancia está en top-5, no en top-1', 'El challenger acierta más en las posiciones 4–5 y un poco menos en la 1; los vendedores casi siempre eligen la primera o la segunda', 'Una métrica offline ponderada por posición, o top-1 como métrica de gate'],
            ['El golden set tiene 8 meses', 'La ganancia está en categorías que hoy tienen poco tráfico; en las de temporada, empata', 'Evaluar también sobre un set reciente, pesado por el tráfico actual'],
            ['El challenger es más pesado', 'En el pico, la tasa de 504 (timeout de 150 ms a Triton) sube de ' + E('0.1 %') + ' a ' + E('1.5 %') + ': esos vendedores ven el selector manual', 'El gate de rendimiento a 500 req/s y el p99 del shadow en el mismo tipo de GPU'],
          ] },
          { t: 'p', html: `Ninguna de las tres es un "bug" del modelo, y ninguna la ve una evaluación offline que solo reporta top-5 promedio.` },
          { t: 'h3', text: 'Las causas, en general' },
          { t: 'table', head: ['Causa', 'Qué es', 'En los casos'], rows: [
            ['Métrica proxy', 'Offline mides lo que puedes calcular con labels (accuracy); online importa otra cosa (aceptación, ingresos)', 'c01: top-5 vs aceptación'],
            ['Distribución distinta', 'El set de evaluación no se parece al tráfico de hoy: temporada, productos nuevos, cámaras nuevas', 'c02: un sitio nuevo; c03: un lote de material nuevo'],
            ['Feedback loop', 'Los labels salen de lo que el modelo anterior mostró; el modelo nuevo "pierde" offline por no imitar al viejo, o gana por imitarlo', 'c01: la categoría que elige el vendedor está sesgada por la sugerencia'],
            ['Sesgo de posición', 'Los usuarios interactúan más con lo que está arriba; offline todas las posiciones pesan igual', 'c01: top-1 vs posiciones 4–5; cualquier ranking'],
            ['Latencia', 'Un modelo más lento cambia la experiencia: timeouts, fallbacks, abandono', 'c01: timeouts → selector manual'],
            ['Labels demorados', 'La métrica online "de verdad" llega tarde y te quedas con proxies rápidos', 'c01: re-categorización en días; c03: escapes en semanas'],
            ['Skew de serving', 'Lo servido no es lo evaluado: preprocesamiento, precisión FP16/INT8, versiones de librerías', 'Parity tests de c01 y c02 (<a href="#m09.skew">M9</a>, <a href="#m08.validar">M8</a>)'],
            ['Interacción con el sistema', 'El modelo cambia qué ve el usuario, eso cambia sus acciones y el contexto de la siguiente predicción', 'Recomendación (<a href="#c08">c08</a>)'],
          ] },
          { t: 'h3', text: 'Cómo se achica la brecha' },
          { t: 'list', items: [
            '<b>Evaluación offline más parecida al producto</b>: métricas por posición (top-1, MRR), slices pesados por el tráfico actual, un set reciente además del golden congelado, y el mismo artefacto que se sirve (parity).',
            '<b>Replay</b>: correr el challenger sobre requests reales registrados y comparar con lo que pasó. Sirve para distribución, latencia y acuerdo; no dice qué habría hecho el usuario con una respuesta que nunca vio.',
            '<b>Evaluación contrafactual (off-policy)</b>: estimar la métrica online de un modelo nuevo con logs del viejo, reponderando cada ejemplo por la probabilidad con que el modelo viejo mostró lo que mostró (inverse propensity scoring). Exige haber logueado esas probabilidades y algo de exploración, y tiene mucha varianza. Es práctica común en recomendación y ranking; en c01 no se usa.',
            '<b>Shadow</b> con revisión de desacuerdos: la mejor evidencia pre-A/B de que la ganancia offline existe en el tráfico real.',
            '<b>Un registro de lanzamientos</b>: por cada release, el delta offline y el delta online. Después de diez releases sabes cuánto predice tu métrica offline, y cuál conviene cambiar.',
          ] },
          { t: 'callout', kind: 'senior', html: `<p>Frase que suma mucho: "I keep a table of past launches with the offline delta next to the online delta. That tells me how much a golden-set gain is worth in production, and when they stop agreeing, that's a sign the offline metric or the golden set needs to change."</p>` },
          { t: 'callout', kind: 'trap', title: 'Ajustar el umbral del gate hasta que el A/B coincida', html: `<p>Si el A/B sale plano, la reacción mala es exigir más ganancia offline ("ahora pedimos +3 pp"). Eso no arregla una métrica que mide otra cosa; solo frena los modelos buenos. Primero se entiende por qué no coinciden (tabla de arriba) y se cambia la métrica o el set.</p>` },
          { t: 'callout', kind: 'connect', html: `<p>Training-serving skew y cómo evitarlo con código compartido y feature stores: <a href="#m09.skew">M9</a>. Golden set y gate: <a href="#m10.gate">M10</a>. Qué vigilar después de la promoción (drift, labels demorados): <a href="#m12">M12</a>.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"I expect some gap between offline and online, so I design for it. The gate uses top-1 and slices weighted by current traffic, not just average top-5. The shadow tells me whether the gain shows up on real traffic, and the performance gate at design peak catches models that would win offline and lose on timeouts."</p>` },
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
            { q: 'Un challenger de c01 lleva dos días en shadow con 91 % de acuerdo top-1, sin errores y con el mismo p99. ¿Qué te falta para pasar al canary?',
              options: ['Nada: sin errores y con el mismo p99, está listo', 'Etiquetar una muestra de los desacuerdos para saber quién acierta, y revisarlo por slice', 'Otra semana de shadow para medir la tasa de aceptación', 'Subir el acuerdo a 99 %'],
              answer: 1,
              explain: 'El acuerdo dice cuánto cambian las respuestas, no si mejoran. El shadow no mide aceptación porque nadie vio las sugerencias. Un acuerdo de 99 % solo se espera si el modelo no cambió (un upgrade de Triton, por ejemplo).' },
            { q: 'Tienes 2 pods de Triton y un Deployment canary con 1 pod, sin configurar pesos en el proxy. ¿Qué porcentaje del tráfico recibe el canary?',
              options: ['5 %', 'Lo que diga el Service', 'Alrededor de un tercio', '0 % hasta que lo promuevas'],
              answer: 2,
              explain: 'Kubernetes reparte por pods listos: 1 de 3. Para un 5 % real, el peso lo pone el proxy (ALB, malla, gateway). Argo Rollouts sin trafficRouting también aproxima el peso con réplicas.' },
            { q: 'El A/B de c01 se configuró 50/50 y llegaron 50,600 publicaciones a un brazo y 49,400 al otro. ¿Qué haces?',
              options: ['Leer el resultado: la diferencia es de 1.2 %', 'Reponderar los brazos y leer el resultado', 'No leerlo: χ² ≈ 14.4 (p ≈ 0.00015) indica un sample ratio mismatch; primero encuentras la causa', 'Correrlo una semana más para que se equilibre'],
              answer: 2,
              explain: 'Con 100k unidades, un desbalance así no es azar. Algo pierde o agrega unidades en un brazo (timeouts antes de loguear, bots, asignación), y eso sesga la métrica. Reponderar no arregla un sesgo que no conoces.' },
            { q: 'Quieres detectar +0.5 pp sobre 70 % de aceptación en vez de +1 pp. ¿Cuánto cambia la muestra por brazo?',
              options: ['Se duplica (≈ 65k)', 'Se cuadruplica (≈ 131k)', 'Se reduce a la mitad', 'No cambia: depende de α y de la potencia'],
              answer: 1,
              explain: 'n crece con 1/δ²: la mitad de MDE cuesta 4× la muestra. Con la fórmula exacta, ≈ 32,650 → ≈ 131,200 por brazo.' },
            { q: 'Miras el A/B todos los días durante 14 días y lo paras la primera vez que p &lt; 0.05. Sin efecto real, ¿con qué frecuencia "encuentras" uno?',
              options: ['5 %', 'Alrededor del 20 %', '50 %', '0 %: el test está bien calibrado'],
              answer: 1,
              explain: 'En nuestra simulación de A/A tests con 14 miradas, 21.5 %. Por eso se fija la duración antes o se usa un test secuencial diseñado para mirar.' },
            { q: 'Promoviste un modelo nuevo y te das cuenta de que un cambio en el pipeline de features, desplegado junto, escribió valores malos en el online store. ¿Basta con volver al modelo anterior?',
              options: ['Sí: el modelo anterior no usa ese pipeline', 'No: el modelo anterior lee las mismas features malas; hay que revertir el pipeline y recalcular los valores afectados', 'Sí, si el rollback es en menos de 5 minutos', 'No: hay que reentrenar el modelo anterior'],
              answer: 1,
              explain: 'Los modelos se revierten con un puntero; los datos son estado ya escrito. Revertir el código del pipeline no borra lo que escribió: hace falta un backfill.' },
            { q: '¿Por qué c02 no puede medir con un A/B clásico si el detector nuevo mejora el recall?',
              options: ['Porque 1,000 cámaras son muy pocas unidades', 'Porque no hay control ciego, las cámaras no son intercambiables y lo que un modelo no detecta no aparece en ninguna métrica online', 'Porque los detectores corren en el edge', 'Porque el SOC no quiere participar'],
              answer: 1,
              explain: 'Por eso c02 usa shadow pareado, replay de clips, canary de sitios contra su semana anterior y walk tests con verdad conocida.' },
            { q: 'Tienes 40 miniaturas candidatas para una promoción que dura 5 días y el clic se mide al instante. ¿Qué eliges?',
              options: ['A/B test con 40 brazos', 'Un bandit (por ejemplo, Thompson sampling)', 'Interleaving', 'Shadow'],
              answer: 1,
              explain: 'Muchas variantes, vida corta y recompensa inmediata: el caso de libro para un bandit. Un A/B con 40 brazos repartiría el tráfico por igual hasta que la promo terminara.' },
            { q: 'Tu modelo gana 1.5 pp de top-5 offline y el A/B sale plano. ¿Cuál NO es una explicación razonable?',
              options: ['Los usuarios eligen casi siempre la primera sugerencia y la ganancia está en las posiciones 4–5', 'El golden set ya no se parece al tráfico actual', 'El modelo nuevo causa más timeouts en el pico', 'El A/B no sirve para modelos de visión'],
              answer: 3,
              explain: 'Las tres primeras son causas típicas de la brecha offline–online (sesgo de posición, distribución distinta, latencia). El tipo de modelo no tiene nada que ver con si un A/B funciona.' },
          ] },
          { t: 'checklist', id: 'antes-de-desplegar', items: [
            { id: 'preguntas', html: 'Separo las tres preguntas (¿mejor offline?, ¿seguro?, ¿mejora el producto?) y elijo gate, shadow, canary y A/B según el cambio.' },
            { id: 'shadow-sin-efectos', html: 'El shadow es asíncrono, con timeout y cola acotada, no escribe nada en el mundo y sus métricas llevan su propia etiqueta.' },
            { id: 'desacuerdos', html: 'Etiqueto una muestra de los desacuerdos del shadow y lo reviso por slice.' },
            { id: 'porcentaje', html: 'Justifico el porcentaje del canary con el volumen (requests por ventana) y cada etapa cubre al menos un pico.' },
            { id: 'criterios', html: 'Tengo criterios escritos para revertir y para avanzar, relativos al estable, con n mínimo, y revierten solos.' },
            { id: 'pesos', html: 'El porcentaje lo pone el proxy (ALB, malla, gateway), no el número de pods.' },
            { id: 'ab-cuatro', html: 'Para el A/B digo unidad de aleatorización, métrica primaria + guardrails, tamaño de muestra y duración en semanas completas.' },
            { id: 'ab-trampas', html: 'Menciono peeking (duración fija o test secuencial) y reviso SRM antes de leer el resultado.' },
            { id: 'dos-versiones', html: '<code>model_version</code> en logs, métricas y claves de cache; labels dentro del artefacto del modelo; features viejas vivas mientras la versión vieja pueda volver.' },
            { id: 'rollback-listo', html: 'La release anterior sigue viva durante el bake y guardo imagen por digest, engine, configuración y features de la versión anterior.' },
            { id: 'datos-no-puntero', html: 'Sé que revertir un cambio de datos o de features exige recalcular, no solo mover un puntero.' },
            { id: 'brecha', html: 'Anticipo la brecha offline–online (proxy, distribución, posición, latencia, feedback loop) y digo cómo la achico.' },
          ] },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'm11-01', kind: 'concepto', q: 'Las tres preguntas de un despliegue y qué mecanismo responde cada una.',
        a: '¿Es mejor sobre datos etiquetados? → gate offline. ¿Es seguro con tráfico real? → shadow y canary. ¿Mejora el producto? → A/B test. Cada una tiene su riesgo: técnico (minutos), calidad del modelo (horas a días), negocio (semanas).' },
      { id: 'm11-02', kind: 'trampa', q: '"Lo despliego con un rolling update de Kubernetes, que ya es gradual."',
        a: 'El rolling update solo mira la readiness (el proceso está vivo), no la calidad de las predicciones, y reparte por número de pods, sin comparar contra nada. Un modelo que devuelve categorías equivocadas pasa todas las probes.' },
      { id: 'm11-03', kind: 'concepto', q: '¿Qué comparas en un shadow y qué no puede medir?',
        a: 'Acuerdo (top-1, solapamiento del top-5), p99 y timeouts, errores, distribución de predicciones y de confianza, por slice; y una muestra de desacuerdos etiquetada. No mide al usuario: nadie vio las respuestas del challenger.' },
      { id: 'm11-04', kind: 'trampa', q: 'Efectos secundarios que un shadow nunca debe tener.',
        a: 'Escribir en la base de datos, mandar notificaciones, cobrar, consumir cuotas o rate limits, escribir en caches o feature stores compartidos, llamar APIs de pago, actuar sobre el mundo (PLC en c03, alertas al SOC en c02), ni mezclar sus métricas con las de producción.' },
      { id: 'm11-05', kind: 'numero', q: 'Requests del canary de c01 al 5 % en 10 minutos.',
        a: '≈ 10,500 en el pico (350 req/s) y ≈ 3,500 en el promedio (116 req/s). Con el estable 19× más grande, detectar 5xx de 0.1 % → 0.2 % pide ≈ 10,700 requests; de 0.1 % → 0.5 %, ≈ 1,050.' },
      { id: 'm11-06', kind: 'tradeoff', q: '¿Por qué el canary de c01 empieza en 5 % y no en 1 % ni 20 %?',
        a: '1 %: ≈ 2,100 requests en 10 min de pico, muy poco para ver fallas sutiles sin esperar horas. 20 %: un modelo malo afecta a 1 de cada 5 requests antes de la alarma. En servicios con mucho más tráfico, 1 % alcanza: se elige por volumen.' },
      { id: 'm11-07', kind: 'concepto', q: 'Criterios para avanzar un canary (no solo para revertir).',
        a: 'Señales verdes toda la ventana, n mínimo del canary, tiempo mínimo con un pico diurno, sin incidentes de dependencias que invaliden la comparación, y aprobación humana para el paso final a 100 %.' },
      { id: 'm11-08', kind: 'trampa', q: '2 pods de Triton estables + 1 pod canary, sin pesos en el proxy: ¿cuánto tráfico ve el canary?',
        a: '≈ 1/3, no 5 %. Kubernetes reparte por pods; con GPUs no tendrás 20 réplicas. El porcentaje lo pone el ALB, la malla o el gateway (Argo Rollouts con trafficRouting).' },
      { id: 'm11-09', kind: 'tradeoff', q: 'Canary por request vs por usuario.',
        a: 'Por request (pesos en el balanceador): bien para salud operativa (5xx, p99). Por usuario (hash de un id estable → header): obligatorio para medir comportamiento, porque el mismo usuario no debe ver dos modelos. La cookie del ALB no sirve para callers server-to-server, que normalmente no la guardan.' },
      { id: 'm11-10', kind: 'tradeoff', q: 'Blue/green vs canary.',
        a: 'Blue/green: dos entornos completos, switch atómico y vuelta en segundos, cuesta un entorno extra durante el bake; bueno si no pueden convivir versiones sobre tráfico mezclado o para batch. Canary: exposición gradual comparada contra el estable. c01 hace canary y deja la anterior viva 24–48 h (≈ US$25–50).' },
      { id: 'm11-11', kind: 'trampa', q: 'Blue/green en Argo Rollouts: ¿cuánto sigue vivo blue después de promover por defecto?',
        a: '30 segundos (scaleDownDelaySeconds). Si tu rollback cuenta con blue durante un día, súbelo y paga el costo.' },
      { id: 'm11-12', kind: 'concepto', q: 'Lo que blue y green comparten y puede romper el switch de vuelta.',
        a: 'Esquema de la base de datos, versiones de features, prediction cache sin versión en la clave, mensajes en cola con formato nuevo y la capacidad caliente (warmup, nodos GPU con imagen).' },
      { id: 'm11-13', kind: 'numero', q: 'Tamaño de muestra del A/B de c01 (70 % → 71 %, α 0.05, potencia 0.8).',
        a: 'Regla práctica 16 × 0.21 ÷ 0.0001 ≈ 33,600; fórmula exacta ≈ 32,650 → ≈ 33k por brazo. MDE de 0.5 pp: ≈ 131k (4×); de 2 pp: ≈ 8.1k.' },
      { id: 'm11-14', kind: 'concepto', q: 'Las cuatro cosas que tiene que tener un "haría un A/B".',
        a: 'Unidad de aleatorización (en c01, el vendedor, con hash + salt), una métrica primaria con guardrails, tamaño de muestra con MDE, α y potencia, y duración en semanas completas.' },
      { id: 'm11-15', kind: 'numero', q: 'Design effect si cada vendedor aporta 3 publicaciones con correlación 0.2.',
        a: '1 + (3 − 1) × 0.2 = 1.4 → ≈ 45,700 publicaciones por brazo en vez de ≈ 32,650. La varianza se calcula agrupando por vendedor.' },
      { id: 'm11-16', kind: 'numero', q: '¿Cuánto infla el peeking los falsos positivos?',
        a: 'En una simulación de A/A tests con 14 miradas diarias y parando en la primera p &lt; 0.05: 21.5 % en vez de 5 %. Solución: duración fija o test secuencial (alpha spending, mSPRT, confidence sequences).' },
      { id: 'm11-17', kind: 'concepto', q: '¿Qué es un sample ratio mismatch y qué haces si aparece?',
        a: 'El reparto observado no es el configurado más allá del azar (chi-cuadrado). 50,600 vs 49,400 con 50/50: χ² = 14.4, p ≈ 0.00015. No se lee el resultado: algo pierde unidades en un brazo (timeouts antes de loguear, bots, asignación, logging).' },
      { id: 'm11-18', kind: 'concepto', q: 'Interferencia en un A/B y cómo se mitiga.',
        a: 'Lo que ve un usuario afecta a otros (marketplaces, precios, logística): el tratamiento le quita al control y el efecto se exagera. Se aleatoriza por grupo (ciudad, mercado) o por tiempo (switchback), a costa de potencia.' },
      { id: 'm11-19', kind: 'concepto', q: '¿Qué hacen c02 y c03 en lugar de un A/B clásico?',
        a: 'Comparación pareada (shadow: los dos modelos sobre el mismo input), replay de datos etiquetados, canary de sitios o de línea contra su propio antes, y verdad conocida sembrada (walk tests en c02, piezas patrón en c03).' },
      { id: 'm11-20', kind: 'tradeoff', q: 'Interleaving: cuándo sí y cuándo no.',
        a: 'Sí: elegir entre rankers con poco tráfico; compara dentro del mismo usuario y Netflix reportó más de 100× menos usuarios que su A/B más sensible. No: medir un efecto absoluto de negocio, latencia o costo, o cambios que no son listas.' },
      { id: 'm11-21', kind: 'tradeoff', q: 'Bandit vs A/B.',
        a: 'Bandit: muchas variantes, vida corta, recompensa inmediata; minimiza el regret pero complica la inferencia y olvida guardrails. A/B: decisión duradera y un efecto defendible. En c01 el regret de un A/B es ≈ 330 aceptaciones: no vale un bandit.' },
      { id: 'm11-22', kind: 'trampa', q: '<code>labels.json</code> en la imagen del gateway y el modelo en la de Triton, desplegados por separado.',
        a: 'Si se desalinean, cada request responde 200 con scores normales pero el nombre de otra categoría: falla silenciosa. Los labels viajan con el modelo (mismo artefacto, hash) y el gateway verifica versión y cantidad al arrancar y en la readiness.' },
      { id: 'm11-23', kind: 'concepto', q: 'Expand and contract para pasar de 500 a 501 categorías.',
        a: '1) Los consumidores aprenden la categoría nueva. 2) Modelo y labels nuevos como una release propia (gateway + Triton). 3) Conviven durante shadow y canary, con model_version en logs. 4) Se retira lo viejo al terminar el bake.' },
      { id: 'm11-24', kind: 'trampa', q: '"Si algo sale mal con las features, vuelvo al modelo anterior."',
        a: 'El modelo anterior lee las mismas features malas. Hay que revertir el pipeline y recalcular lo escrito en el online store (backfill). Los datos son estado, no un puntero.' },
      { id: 'm11-25', kind: 'concepto', q: 'Causas de la brecha offline–online.',
        a: 'Métrica proxy, distribución distinta (set viejo), feedback loop en los labels, sesgo de posición, latencia (timeouts y fallbacks), labels demorados, skew de serving e interacción del modelo con el sistema.' },
      { id: 'm11-26', kind: 'frase', q: '¿Cómo describes en inglés tu plan de despliegue para c01?',
        a: '"It goes through shadow for a day or two, then a canary at five, twenty-five and a hundred percent with automatic rollback against the stable version. Big changes get a two-week A/B test on acceptance rate, and the previous release stays up for a day or two after promotion."' },
      { id: 'm11-27', kind: 'frase', q: '¿Cómo defiendes en inglés el tamaño de muestra del A/B?',
        a: '"To detect one point over a seventy percent baseline at alpha 0.05 and eighty percent power, we need about thirty-three thousand listings per arm. We get that in hours, but we run two full weeks for weekly seasonality and novelty, and we check for sample ratio mismatch first."' },
      { id: 'm11-28', kind: 'frase', q: '¿Cómo dices en inglés tu regla ante un despliegue sospechoso?',
        a: '"Roll back first, investigate later. If the regression lines up with the deploy, traffic goes back to the previous release, which is still running, and we debug without users paying for it."' },
    ],

    // ---------------------------------------------------------- glosario
    // Términos nuevos de este módulo. A/B test, blue/green deployment, canary release,
    // canary site, champion / challenger, shadow deployment, rollback, rollout waves,
    // guardrail metric, minimum detectable effect (MDE), peeking, proxy metric, PSI,
    // top-1 agreement, feedback loop, delayed labels, selection bias y runbook ya los
    // definen páginas anteriores: no se repiten.
    glossary: [
      { en: 'traffic mirroring', es: 'réplica de tráfico', def: 'Mandar una copia de requests reales a otro servicio y descartar su respuesta. Es el mecanismo del shadow deployment; en Istio se configura con <code>mirror</code> y <code>mirrorPercentage</code>.', say: 'We mirror ten percent of traffic to the challenger and throw away its responses.' },
      { en: 'dark launch', es: 'lanzamiento oscuro', def: 'Desplegar una función o un modelo a producción sin que el usuario vea su efecto: corre con tráfico real, pero su salida no se muestra (shadow) o está detrás de un flag apagado.', say: 'The new model is dark launched first, so it sees real traffic before anyone sees its output.' },
      { en: 'progressive delivery', es: 'entrega progresiva', def: 'Exponer un cambio a porcentajes crecientes de tráfico con análisis automático en cada paso y rollback si algo se rompe (canary, blue/green con análisis, olas).', say: 'We use progressive delivery, so every release goes five, twenty-five and a hundred percent with automatic analysis.' },
      { en: 'Argo Rollouts', es: 'Argo Rollouts', def: 'Controlador de Kubernetes con el recurso <code>Rollout</code>: canary por pasos (<code>setWeight</code>, <code>pause</code>) y blue/green, con <code>AnalysisTemplate</code> que consulta métricas (Prometheus, Datadog, HTTP o un Job) y aborta volviendo al estable.', say: 'Argo Rollouts queries Prometheus at every step and aborts the canary if the error rate goes up.' },
      { en: 'Flagger', es: 'Flagger', def: 'Operador de entrega progresiva de la familia Flux (CNCF): canary, A/B por header o cookie, blue/green y mirroring sobre una malla o un ingress soportado, con análisis por métricas.', say: 'Flagger shifts traffic through the mesh and rolls back when the success rate drops.' },
      { en: 'bake time', es: 'tiempo de horneado', def: 'Período en que una versión nueva corre con tráfico real mientras la anterior sigue disponible para volver; en SageMaker se llama <i>baking period</i>. En c01, 24–48 h con la release anterior viva.', say: 'After promotion there\'s a forty-eight hour bake, and the previous release stays up the whole time.' },
      { en: 'feature flag', es: 'bandera de funcionalidad', def: 'Condición en el código evaluada en tiempo de ejecución contra una configuración remota, que activa un comportamiento para un porcentaje o segmento sin desplegar. Separa desplegar de activar.', say: 'The code ships dark behind a feature flag, and we turn it on for ten percent of sellers.' },
      { en: 'kill switch', es: 'interruptor de apagado', def: 'Feature flag que apaga una función entera sin desplegar nada; en c01, volver al selector manual de categoría para todos.', say: 'If suggestions go wrong, the kill switch takes everyone back to the manual picker in seconds.' },
      { en: 'OpenFeature', es: 'OpenFeature', def: 'Especificación abierta de API y SDKs para evaluar feature flags sin atarse a un proveedor. Proyecto en incubación de la CNCF.', say: 'We call flags through OpenFeature, so switching vendors doesn\'t touch the service code.' },
      { en: 'sticky assignment', es: 'asignación persistente', def: 'Asignar cada usuario siempre al mismo brazo o versión, normalmente con un hash de un id estable; evita que el mismo usuario vea dos modelos.', say: 'Assignment is sticky by seller ID, so a seller never sees two models in the same listing.' },
      { en: 'randomization unit', es: 'unidad de aleatorización', def: 'Lo que se sortea entre brazos de un experimento: usuario, sesión, request, grupo o bloque de tiempo. Decide qué contaminación evitas y cómo se calcula la varianza.', say: 'The randomization unit is the seller, so the variance is computed at the seller level.' },
      { en: 'statistical power', es: 'potencia estadística', def: 'Probabilidad de detectar un efecto del tamaño del MDE si existe; se usa 0.8 por convención. Junto con α y el MDE, fija el tamaño de muestra.', say: 'With eighty percent power we still miss a real one-point lift one time in five.' },
      { en: 'overall evaluation criterion (OEC)', es: 'criterio de evaluación global', def: 'La métrica primaria acordada antes del experimento, la que decide. En c01, la tasa de aceptación de sugerencias.', say: 'The OEC is acceptance rate, and everything else is either a guardrail or a secondary metric.' },
      { en: 'design effect', es: 'efecto de diseño', def: 'Factor que infla la varianza cuando las observaciones vienen en grupos correlacionados: <code>1 + (m − 1) · ρ</code>, con m observaciones por grupo y ρ la correlación dentro del grupo.', say: 'Sellers post several listings, so the design effect pushes the sample from thirty-three to about forty-six thousand.' },
      { en: 'novelty effect', es: 'efecto novedad', def: 'Cambio de comportamiento temporal ante algo nuevo (curiosidad o rechazo) que se desvanece en días; una razón para correr semanas y mirar la métrica por día.', say: 'The lift shrinks every day, which looks like a novelty effect, so we keep it running.' },
      { en: 'sequential testing', es: 'test secuencial', def: 'Diseños que permiten mirar un experimento muchas veces sin inflar los falsos positivos: grupo secuencial con alpha spending, mSPRT o confidence sequences.', say: 'If product wants to peek, we switch to sequential testing instead of stopping at the first p below 0.05.' },
      { en: 'sample ratio mismatch (SRM)', es: 'desbalance del reparto', def: 'Diferencia entre el reparto observado de unidades y el configurado que el azar no explica (test de chi-cuadrado). Casi siempre revela un sesgo; no se lee el resultado hasta entenderlo.', say: 'We got a sample ratio mismatch, so nobody reads the results until we find where units are lost.' },
      { en: 'interference (network effects)', es: 'interferencia entre unidades', def: 'Cuando el tratamiento de una unidad afecta el resultado de otra (compradores y vendedores compartidos, precios); viola el supuesto del A/B y exagera el efecto.', say: 'Pricing has interference between arms, so we randomize by city instead of by user.' },
      { en: 'switchback experiment', es: 'experimento por alternancia', def: 'Experimento en el que todo un mercado alterna entre A y B por bloques de tiempo; se usa cuando hay interferencia entre usuarios.', say: 'For the dispatch model we\'d run a switchback, alternating the whole city every hour.' },
      { en: 'CUPED', es: 'CUPED (reducción de varianza)', def: 'Técnica que reduce la varianza de un A/B usando la métrica de cada unidad antes del experimento como covariable (Deng et al., 2013); acorta el experimento para la misma potencia.', say: 'With CUPED on pre-experiment acceptance, we\'d need fewer sellers for the same power.' },
      { en: 'holdout group', es: 'grupo de retención', def: 'Porcentaje chico de usuarios que se deja sin el cambio (o sin la función) por meses para medir efectos acumulados; en c01, ≈ 1 % de vendedores sin sugerencias.', say: 'A one percent holdout without suggestions gives us clean labels and the long-term value of the feature.' },
      { en: 'interleaving', es: 'intercalado', def: 'Comparar dos rankers mostrando a cada usuario una lista mezclada (p. ej. team-draft: se turnan para aportar ítems) y acreditando cada interacción al ranker que aportó el ítem. Mucho más sensible que un A/B, pero solo da una preferencia.', say: 'We interleave the two rankers to pick a winner in days, then A/B test the finalist.' },
      { en: 'multi-armed bandit', es: 'bandido multibrazo', def: 'Asignación adaptativa que mueve tráfico hacia la variante que rinde mejor mientras sigue explorando (epsilon-greedy, UCB, Thompson sampling). Minimiza la pérdida durante la prueba a costa de una inferencia más difícil.', say: 'For forty thumbnails that live five days, a bandit beats a forty-arm A/B test.' },
      { en: 'regret', es: 'pérdida por explorar', def: 'Recompensa perdida por mostrar variantes peores que la mejor mientras aprendes; lo que un bandit intenta minimizar.', say: 'The regret of our A/B is about three hundred accepted suggestions, which isn\'t worth a bandit.' },
      { en: 'expand and contract', es: 'expandir y contraer', def: 'Patrón para cambios incompatibles (también <i>parallel change</i>): primero todos aceptan lo nuevo, después se produce lo nuevo, al final se retira lo viejo. Aplica a esquemas, APIs, features y labels.', say: 'The schema change goes expand and contract, so blue can still read the table if we roll back.' },
      { en: 'offline–online gap', es: 'brecha offline–online', def: 'Diferencia entre la mejora que muestra la evaluación offline y la que se observa online, por métricas proxy, distribución distinta, feedback loops, sesgo de posición, latencia o skew.', say: 'We track the offline–online gap per launch to know what a golden-set gain is really worth.' },
      { en: 'position bias', es: 'sesgo de posición', def: 'Los usuarios interactúan más con lo que aparece arriba, independientemente de su calidad. Hace que las métricas offline que pesan todas las posiciones igual sobreestimen ganancias abajo en la lista.', say: 'Most of the gain is in positions four and five, and position bias means sellers rarely look there.' },
      { en: 'off-policy evaluation', es: 'evaluación contrafactual', def: 'Estimar la métrica online de un modelo nuevo con logs del modelo anterior, reponderando por la probabilidad con que el anterior mostró cada ítem (inverse propensity scoring). Requiere loguear esas probabilidades y tiene alta varianza.', say: 'Because we log propensities, we can run off-policy evaluation before the A/B test.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
