# Laboratorio Transformer

Una aplicación web para ver **el entrenamiento completo de un transformer pequeño (tipo GPT)**,
operación por operación: del texto a los tokens, los embeddings, la atención (con cada subpaso),
la FFN, los logits, el softmax y la pérdida; después, **todo el backward** (cada gradiente) y la
**actualización** de cada parámetro con el optimizador.

En cada momento verás la fórmula exacta, las matrices que entran y salen (como mapas de calor con
sus números), sus **dimensiones en símbolos y en números** (`T×d` y `5×8`) y una explicación
matemática en español. Nada es una animación pregrabada: todo se calcula en tu navegador con un
modelo real, escrito a mano en JavaScript (sin librerías de ML).

## Cómo abrirlo

- **Directamente:** haz doble clic en `index.html`. Funciona desde el disco (`file://`), sin servidor.
- **Un solo archivo:** `npm run build` (o `node build.mjs`) genera `dist/transformer-lab.html`, con
  todo el CSS y el JavaScript incrustados. También crea `dist/artifact.html`, el mismo contenido sin
  las etiquetas `<html>`, `<head>` y `<body>`, para publicarlo dentro de otra página.

Solo hay dos recursos externos: **MathJax 3** (para componer las fórmulas) y las fuentes de Google
Fonts. Sin conexión la aplicación funciona igual: las fórmulas se muestran como código LaTeX y se
usan las fuentes del sistema.

## Las cuatro pestañas

### 1 · Paso a paso
Una iteración de entrenamiento completa sobre una frase del corpus («el gato come pescado .» al
empezar). Con la configuración por defecto son **91 pasos**: datos (1), forward (28), pérdida (1),
backward (44) y actualización (17, uno por parámetro, precedidos de la norma del gradiente).

- **Izquierda — esquema de la arquitectura.** El bloque del paso actual se ilumina con el color de
  su fase; en el backward las flechas se invierten. Cada arista muestra la forma del tensor que
  circula (`T×d · 5×8`). Haz clic en un bloque para ir a su primer paso en la fase actual.
- **Centro — la operación.** Fase, número de paso, fórmula, dimensiones (símbolos y números) y
  coste en multiplicaciones y sumas. Debajo, la operación dibujada como una ecuación de matrices.
  **Pasa el cursor por una celda** (o tócala, o recórrelas con `Tab` y las flechas): se resaltan las
  celdas que la producen y el *inspector* muestra la cuenta completa con sus números. En pantallas
  anchas el inspector está al pie de la columna derecha (así no tapa las matrices); en pantallas
  más estrechas, bajo la operación. «Animar» reproduce la operación celda a celda; el botón
  **Números** alterna entre *auto* (números donde caben; las matrices grandes van solo con color),
  *todos* y *no* (solo color).
- **Derecha — la explicación.** Resumen, intuición, fórmulas, cómo cambian las dimensiones,
  derivación detallada (en el backward se deriva cada gradiente), pseudocódigo estilo NumPy y
  enlaces a derivaciones largas (regla de la cadena, jacobiano del softmax, LayerNorm, Adam…).
  Arriba, los símbolos con su valor actual (`T = 5`, `d = 8`, `h = 2`, `d_k = 4`…). La pestaña
  **Tensores vivos** lista todos los tensores calculados hasta ese paso; pulsa uno para ir al paso
  que lo produjo.
- **Abajo — línea de tiempo.** Una marca por paso, coloreada por fase; haz clic o arrastra para
  moverte. Botones de paso anterior/siguiente, reproducción automática con velocidad (0.5× a 4×) y
  saltos al inicio de cada fase. El selector de frase y **Nueva iteración** trazan otra iteración con
  los pesos ya actualizados: la pérdida baja iteración a iteración (el minigráfico la dibuja).

Colores de fase: **datos** gris pizarra, **forward** verde azulado (la pérdida cierra el forward),
**backward** magenta y **actualización** ocre.

### 2 · Entrenamiento
Cientos de iteraciones seguidas (minilotes de frases, gradientes promediados, sin traza).
Entrenar/Pausa, +1, +10, +100, velocidad, tasa de aprendizaje, optimizador (Adam o SGD) y tamaño de
minilote. Se ven en vivo: la curva de pérdida (con media móvil, escala logarítmica opcional y la
referencia `ln V` de un modelo que acierta al azar), la perplejidad, la pérdida de cada frase, la
norma del gradiente de cada parámetro, **los mapas de atención de todas las capas y cabezas**, una
tabla de predicciones por posición (las 3 más probables) y los embeddings `E` proyectados en 2-D
con PCA. «Inspeccionar esta iteración» te lleva a *Paso a paso* con los pesos actuales.

### 3 · Generación
Escribe un comienzo («el gato») y el modelo lo continúa token a token: para cada paso verás el
contexto, las 10 probabilidades más altas, el token elegido y la atención de cada cabeza. Modo voraz
o muestreo con temperatura. En inferencia **solo se ejecuta el forward**: no hay pérdida, ni
backward, ni actualización. Las palabras fuera del vocabulario dan un error que lista el vocabulario.

### 4 · Datos y modelo
Corpus editable (una frase por línea), tokenizador por palabras o por caracteres y todos los
hiperparámetros, con validación (por ejemplo, `h` debe dividir a `d`). «Aplicar y reiniciar» crea
un modelo nuevo. Además: tabla de vocabulario, inventario de parámetros (forma, número,
inicialización y descripción), **mapa de dimensiones** con cada tensor del forward y del backward
(forma simbólica y numérica, filtrable por fase, con enlace al paso que lo calcula) y una
**comprobación numérica de gradientes** (diferencias centrales frente al backward).

## Atajos de teclado (en *Paso a paso*)

| Tecla | Acción |
|---|---|
| `←` `→` | paso anterior / siguiente |
| `Espacio` | reproducir o pausar |
| `Inicio` `Fin` | primer / último paso |
| `Tab` | recorrer los controles; en el esquema, `↑` `↓` siguen el flujo y `←` `→` cambian de cabeza |
| `Esc` | cerrar la guía o una derivación |

Los atajos nunca actúan mientras escribes en un campo de texto. El botón **Guía** abre un recorrido
de introducción, la notación y un glosario. El botón de tema alterna Sistema, Claro y Oscuro.

## El modelo por defecto

Decoder-only estilo GPT con *pre-LayerNorm*, entrenado para predecir el siguiente token.

| Símbolo | Significado | Valor |
|---|---|---|
| `T` | tokens de la secuencia (frase 1) | 5 |
| `d` | dimensión del modelo | 8 |
| `h` | cabezas de atención | 2 |
| `d_k = d/h` | dimensión por cabeza | 4 |
| `d_ff` | dimensión oculta de la FFN | 32 |
| `V` | tamaño del vocabulario (con `<s>`) | 22 |
| `N` | capas | 1 |
| `η` | tasa de aprendizaje (Adam) | 0.01 |

Otros valores: ventana de contexto de 8 tokens, ReLU, codificación posicional sinusoidal, Adam con
β₁ = 0.9, β₂ = 0.999 y recorte de la norma global del gradiente a 1, minilotes de 4 frases, semilla
42. El modelo tiene 1 208 parámetros; la pérdida media empieza en unos 3.3 (cerca de ln 22 ≈ 3.09, la de un modelo
que reparte la probabilidad por igual) y baja a unos 0.4 en 200 iteraciones.

## Pruebas

```bash
npm test                      # pruebas del motor (node:test): gradientes, formas, traza, entrenamiento
npm run smoke                 # prueba de humo de la app completa en Chrome sin ventana (unos 20 s)
npm run smoke:dist            # lo mismo sobre dist/transformer-lab.html (primero lo genera)
npm run build                 # genera dist/
node tools/browser-check.mjs --url index.html --width 1440 --height 900 \
     --eval "TL.App.train(200)" --shot /tmp/captura.png     # Chrome sin ventana: errores + captura
```

La prueba de humo (`tools/smoke.js`) recorre **todos los pasos** de la traza en cinco
configuraciones (por defecto; 2 capas y 4 cabezas con GELU y PE aprendida; caracteres; SGD con
recorte; 1 cabeza) y en cada uno comprueba que no hay errores, que la fórmula y las dimensiones se
componen, que la explicación no tiene marcadores sin rellenar, que el inspector responde en varias
celdas y que el esquema marca el bloque activo. Después entrena 300 iteraciones (la pérdida debe
bajar), genera a partir de «el gato come» (debe salir «pescado»), comprueba los gradientes, recorre
las pestañas y los temas y, a 390 px de ancho, que ninguna pestaña ni ningún paso desborde en
horizontal. Devuelve un resumen JSON y falla si algo no se cumple.

`tools/browser-check.mjs` abre la página en Chrome sin interfaz, imprime los mensajes de consola,
evalúa expresiones (`--eval`, `--eval-file`), guarda una captura (`--shot`, `--full`) y termina con
código 1 si hubo errores. Opciones: `--dark`, `--mobile`, `--width`, `--height`, `--wait`, `--timeout`.

Para automatizar la página existe `TL.App`: `goToStep(i)`, `getStep()`, `setTab(id)`,
`newIteration()`, `train(n)`, `generate(prompt, opciones)`, `applyConfig({corpus, tokMode, cfg, hp,
batchSize})`, `gradCheck()`, `setTheme(t)`, `flush()` (aplica ya la explicación y el inspector
pendientes) y `state`.

## Estructura

```
index.html              documento principal (carga los CSS y JS de abajo, en orden)
build.mjs               empaquetador sin dependencias → dist/
css/app.css             tokens de diseño, primitivas y maquetación de la app
css/viz.css             estilos de matrices, mapas de calor y vistas de operaciones
js/core/tensor.js       TL.Mat: matrices Float64Array y generador aleatorio con semilla
js/core/tokenizer.js    TL.Tokenizer: vocabulario, codificación, pares entrada → objetivo
js/core/model.js        TL.Model: forward y backward escritos a mano, con traza paso a paso
js/core/optim.js        TL.Optim: SGD y Adam, recorte del gradiente
js/core/trainer.js      TL.Trainer: sesión, iteración trazada, minilotes, generación, gradcheck
js/content/explain.js   TL.Content: explicaciones, derivaciones, glosario y guía (en español)
js/ui/math.js           TL.MathTex: fórmulas con MathJax (y respaldo sin conexión)
js/ui/heatmap.js        TL.Heatmap: mapas de calor de matrices
js/ui/opviews.js        TL.OpViews: una vista por tipo de operación, con el inspector de celdas
js/ui/diagram.js        TL.Diagram: esquema SVG de la arquitectura
js/ui/charts.js         TL.Charts: curvas, barras y dispersión
js/app.js               TL.App: estado, pestañas, línea de tiempo y cableado de la interfaz
tests/                  pruebas del motor (node --test)
tools/browser-check.mjs comprobación en Chrome sin ventana
tools/smoke.js          prueba de humo de la app completa (para browser-check)
docs/SPEC.md            especificación interna
```

Todo es JavaScript clásico (sin módulos ni dependencias) para que funcione desde el disco. La
aplicación solo guarda en el navegador tus preferencias (tema, aviso de bienvenida cerrado, modo de
los números).
