/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/rt2.js
   Diagramas de RT-2 (SPEC §7.2, ids de §21.1), modelo `rt2`. PESOS CERRADOS: no hay config del calculador, así que estas
   vistas declaran calc:false (+ calcNote): ninguna arista nombra un tensor ni lleva forma; lo que dicen las aristas son
   etiquetas cortas (tag) con hechos citados del paper (Brohan et al., CoRL 2023, arXiv:2307.15818). El validador acepta
   calc:false (sin model/config del calculador, sin tensores) y la práctica no arma drills de formas con estas vistas.
     rt2-overview        imagen + instrucción → el VLM (caja negra: PaLI-X 55B o PaLM-E 12B, "pesos cerrados") → tira de 8
                         tokens de acción (terminar + Δpos 3 + Δrot 3 + pinza), generados token a token (bucle × 8) →
                         detokenizar (bin → valor) → robot; y el co-fine-tuning (web + robot) que entrena al VLM
       rt2-action-tokens una dimensión: valor continuo → 256 bins (la regla, con el bin elegido) → el entero como token de
                         texto → de vuelta al centro del bin
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const NOCALC = { model: 'rt2', calc: false, calcNote: 'Pesos y arquitectura exacta no públicos: el diagrama no tiene formas del calculador; las etiquetas son hechos del paper.' };
  const PAGE = { page: 'rt2', section: 'diagrama' };
  // la tira de la acción: 8 tokens (uno por dimensión), con literales (no hay calculador)
  const ACT_STRIP = {
    segs: [
      { mod: 'txt', n: 1, count: false, label: 'fin' },
      { mod: 'act', n: 1, count: false, label: 'Δx' }, { mod: 'act', n: 1, count: false, label: 'Δy' }, { mod: 'act', n: 1, count: false, label: 'Δz' },
      { mod: 'act', n: 1, count: false, label: 'roll' }, { mod: 'act', n: 1, count: false, label: 'pitch' }, { mod: 'act', n: 1, count: false, label: 'yaw' },
      { mod: 'act', n: 1, count: false, label: 'pinza' },
    ],
    caption: 'un entero 0…255 por token, como texto',
  };

  // ------------------------------------------------------------------ (a) vista general
  ATLAS.registerDiagram(Object.assign({
    id: 'rt2-overview', kind: 'arch', title: 'RT-2 — vista general',
    caption: 'RT-2 es un VLM (PaLI-X o PaLM-E) al que se le enseña a contestar con acciones del robot escritas como texto. Entra la imagen de la cámara y la instrucción; sale una "frase" de 8 tokens: si terminar el episodio, cuánto mover la pinza (Δx, Δy, Δz), cuánto rotarla (Δroll, Δpitch, Δyaw) y cuánto abrirla. Cada valor continuo se discretizó en 256 bins, así que cada token es un entero. Los tokens salen uno por uno (bucle × 8) y se convierten de vuelta a números para el robot. Pesos cerrados: el diagrama no tiene formas.',
    grid: { w: 160, h: 52 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['action-tokens', 'detokenize'], mobileFocusPad: 2,
    edgeLegend: { data: 'Flujo (sin forma: pesos cerrados)', control: 'Bucle de decodificación / entrenamiento' },
    legendText: { loop: 'Bucle: se repite por cada token de la acción', runs: 'Veces que corre el VLM por acción', strip: 'Tira de la acción: 8 tokens (fin = texto rayado; acción = puntos)' },
    nodes: [
      { id: 'image', op: 'io', image: true, imageGrid: 0, label: 'Imagen', x: 1, y: 3, w: 15, h: 17,
        note: 'Una imagen RGB de la cámara del robot por paso de control. RT-2 no le agrega nada al VLM para "ver": la imagen entra como en cualquier pregunta visual.' },
      { id: 'instruction', op: 'io', modality: 'txt', label: 'Instrucción', sub: '"recoge la lata"', x: 1, y: 23, w: 17, h: 8,
        note: 'La orden en lenguaje natural. En el formato de RT-2 va dentro de un prompt tipo pregunta ("¿Qué acción debe hacer el robot para …?") y la respuesta es la acción.' },
      { id: 'vlm', op: 'attn', style: 'closed', flag: 'pesos cerrados', label: 'VLM (caja negra)', sub: 'PaLI-X 55B o PaLM-E 12B\nViT + modelo de lenguaje', runs: '× 8 por acción',
        x: 26, y: 3, w: 40, h: 28,
        note: 'El VLM preentrenado entero, sin capas nuevas: PaLI-X (55B: un ViT de 22B + un encoder-decoder de 32B) o PaLM-E (12B: un ViT de 4B + PaLM de 8B). Google no publicó los pesos ni el código, por eso aquí es una caja negra. Lo nuevo de RT-2 no está adentro sino en la SALIDA: el vocabulario de texto se usa para escribir acciones. Genera los 8 tokens de la acción uno por uno (decodificación autorregresiva): 8 pasadas del modelo por cada acción del robot.' },
      { id: 'action-tokens', op: 'io', modality: 'act', label: 'Tokens de acción', strip: ACT_STRIP, expand: 'rt2-action-tokens', x: 80, y: 4, w: 37, h: 16,
        note: 'La "respuesta" del VLM: 8 tokens. El primero dice si el episodio terminó; los siguientes, el desplazamiento (Δx, Δy, Δz) y la rotación (Δroll, Δpitch, Δyaw) del efector, y la apertura de la pinza. Cada uno es el índice de su bin (0…255) escrito como entero: con PaLI-X cada entero hasta 1000 ya es un token; con PaLM-E se pisan los 256 tokens menos usados del vocabulario. Ábrelo para ver una dimensión.' },
      { id: 'detokenize', op: 'tensorop', shape: 'rect', label: 'Detokenizar', sub: 'bin → valor', x: 125, y: 8, w: 15, h: 8,
        note: 'De vuelta a números: cada entero b se lleva al centro de su bin del rango de esa dimensión. Sin parámetros. El error por discretizar es a lo sumo medio bin (1/512 del rango).' },
      { id: 'robot', op: 'io', modality: 'act', label: 'Robot', sub: '7 DoF', x: 149, y: 6, w: 10, h: 12,
        note: 'El robot ejecuta la acción (un brazo móvil de 7 grados de libertad en el paper) y el ciclo se repite con la imagen nueva. Con el modelo de 55B, en TPUs en la nube, el paper reporta 1–3 Hz (≈ 5 Hz con el de 5B): el VLM grande y los 8 tokens por acción ponen el techo.' },
      { id: 'cofinetune', op: 'io', label: 'Co-fine-tuning', sub: 'datos web (VQA, leyendas) + demos del robot', x: 26, y: 41, w: 40, h: 9,
        note: 'El entrenamiento: se ajusta el VLM entero con una MEZCLA de sus datos web originales (preguntas visuales, leyendas) y trayectorias del robot escritas como texto, en el mismo lote. Así no olvida lo que sabía y "transfiere" conocimiento web a la manipulación (seguir órdenes con objetos o conceptos que nunca vio en los datos del robot). Al generar acciones, la salida se restringe a los tokens de acción válidos.' },
    ],
    edges: [
      { from: 'image', to: 'vlm', kind: 'data', toAt: 0.3, tag: 'imagen', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'instruction', to: 'vlm', kind: 'data', toAt: 0.857, tag: 'texto', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'vlm', to: 'action-tokens', kind: 'data', fromAt: 0.3, toAt: 0.4625, tag: 'uno a uno', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'action-tokens', to: 'vlm', kind: 'control', fromSide: 'bottom', toSide: 'bottom', fromAt: 0.5, toAt: 0.85, via: [[98.5, 36], [60, 36]], tag: 'cada token vuelve a entrar · × 8', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.5, loop: true },
      { from: 'action-tokens', to: 'detokenize', kind: 'data', tag: '8 enteros', tagStyle: 'plain', tagSide: 'above', tagT: 0.5 },
      { from: 'detokenize', to: 'robot', kind: 'data', toAt: 0.5, tag: 'valores', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'cofinetune', to: 'vlm', kind: 'control', fromSide: 'top', toSide: 'bottom', fromAt: 0.3, toAt: 0.3, tag: 'entrena', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido: una acción de RT-2', steps: [
        { nodes: ['image', 'instruction', 'vlm'], edges: ['image>vlm', 'instruction>vlm'],
          text: 'Entran la imagen de la cámara y la instrucción ("recoge la lata"), como en una pregunta visual cualquiera. El modelo es un VLM preentrenado entero (PaLI-X de 55B o PaLM-E de 12B), sin capas nuevas.' },
        { nodes: ['vlm', 'action-tokens'], edges: ['vlm>action-tokens', 'action-tokens>vlm'],
          text: 'La respuesta no es texto libre: son 8 tokens, uno por dimensión de la acción, generados uno por uno. Cada token generado vuelve a entrar para producir el siguiente: <b>8 pasadas del modelo por acción</b>.' },
        { expand: 'rt2-action-tokens', nodes: ['value', 'quantize', 'bins', 'token'], edges: ['value>quantize', 'quantize>bins', 'bins>token'],
          text: 'Cada dimensión continua se discretizó en <b>256 bins</b> uniformes de su rango; el token es el índice del bin escrito como entero (de 0 a 255).' },
        { nodes: ['action-tokens', 'detokenize', 'robot'], edges: ['action-tokens>detokenize', 'detokenize>robot'],
          text: 'Los 8 enteros vuelven a valores (el centro de cada bin) y el robot ejecuta: desplazamiento, rotación y pinza. Con el modelo grande, el paper reporta 1–3 Hz en la nube.' },
        { nodes: ['cofinetune', 'vlm'], edges: ['cofinetune>vlm'],
          text: 'El entrenamiento: co-fine-tuning con datos web y del robot en el mismo lote. Así el modelo conserva lo que sabía de la web y lo usa para seguir órdenes nuevas.' },
      ] },
    ],
    legend: 'auto',
  }, NOCALC, PAGE));

  // ------------------------------------------------------------------ (b) una dimensión: 256 bins y su token
  ATLAS.registerDiagram(Object.assign({
    id: 'rt2-action-tokens', kind: 'arch', title: 'Una dimensión de la acción → 256 bins → un token',
    parent: 'rt2-overview', parentNode: 'action-tokens',
    caption: 'Una dimensión (aquí Δx): el valor continuo cae en uno de 256 bins iguales del rango de esa dimensión; el token es el índice del bin escrito como entero. De vuelta, el entero da el centro del bin. Las otras 6 dimensiones continuas hacen lo mismo con su propio rango; "terminar" es 0 o 1.',
    grid: { w: 132, h: 40 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['bins'],
    edgeLegend: { data: 'Flujo (sin forma: pesos cerrados)' },
    nodes: [
      { id: 'value', op: 'io', modality: 'act', label: 'Δx continuo', sub: 'en [mín, máx]', x: 1, y: 4, w: 16, h: 9,
        note: 'El desplazamiento en x que la demostración hizo en este paso: un número real dentro del rango de esa dimensión en los datos del robot.' },
      { id: 'quantize', op: 'tensorop', shape: 'rect', label: 'Discretizar', sub: 'b = ⌊(x − mín) / Δ⌋', x: 24, y: 4, w: 22, h: 9,
        tex: 'b = \\left\\lfloor \\frac{x - x_{\\min}}{\\Delta} \\right\\rfloor,\\; \\Delta = \\frac{x_{\\max} - x_{\\min}}{256}',
        note: 'Bins uniformes: el rango se parte en 256 intervalos iguales de ancho Δ y x cae en uno. Sin parámetros.' },
      { id: 'bins', op: 'io', label: '256 bins', bins: { n: 256, at: 0.62, label: 'bin b' }, x: 54, y: 1, w: 52, h: 15,
        note: 'La regla de 256 bins de esta dimensión (ilustrativo: el bin marcado es un ejemplo). Con 256 bins, el error máximo al volver al centro del bin es Δ/2 = 1/512 del rango.' },
      { id: 'token', op: 'io', modality: 'txt', label: 'Token', sub: 'el entero, como texto', x: 112, y: 4, w: 19, h: 9,
        note: 'El entero se escribe como texto. PaLI-X ya tiene un token por cada entero hasta 1000, así que cada bin es un token existente; PaLM-E no, y RT-2 pisa los 256 tokens menos usados de su vocabulario. Ocho de estos tokens, separados por espacios, forman la acción.' },
      { id: 'center', op: 'tensorop', shape: 'rect', label: 'De vuelta', sub: 'x = mín + (b + ½)·Δ', x: 54, y: 26, w: 30, h: 9,
        tex: 'x_{\\text{rec}} = x_{\\min} + \\left(b + \\tfrac{1}{2}\\right)\\Delta,\\quad |x - x_{\\text{rec}}| \\le \\tfrac{\\Delta}{2}',
        note: 'Al ejecutar, el token generado se convierte al centro de su bin. El error de cuantización es a lo sumo medio bin.' },
    ],
    edges: [
      { from: 'value', to: 'quantize', kind: 'data', tag: 'x', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'quantize', to: 'bins', kind: 'data', toAt: 0.5, tag: 'b', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'bins', to: 'token', kind: 'data', fromAt: 0.5, tag: 'b', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'token', to: 'center', kind: 'data', fromSide: 'bottom', toSide: 'right', fromAt: 0.5, toAt: 0.5, tag: 'al ejecutar', tagStyle: 'plain', tagSide: 'on', tagSeg: 0, tagT: 0.55 },
    ],
    legend: 'auto',
  }, NOCALC, PAGE));
})(typeof window !== 'undefined' ? window : globalThis);
