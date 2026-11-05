# Guía de contenido de Sensei

Esta guía es para quien escribe lecciones de Sensei, sea una persona o Claude. Léela completa antes de escribir. El ejemplo vivo es `content/lecciones/camino-completo.md`.

## 1. Para quién y para qué

- **Lector:** alguien que apenas entra a la universidad. No sabe nada de ML, computadoras, redes, nube ni estadística. Es listo y tiene ganas, pero no conoce el vocabulario.
- **La meta principal es aprender de verdad.** El lector debe salir entendiendo ML engineering desde los cimientos: cómo funciona cada cosa, por qué existe y cómo se calcula. Debe poder **razonar** con cada concepto, no solo reconocer la palabra. Sensei es la app principal de TrueML junto con el Dojo: el curso de teoría completo, al nivel de un curso universitario introductorio bien hecho, contado en palabras simples.
- **Consecuencias de aprenderlo bien, no la meta en sí:**
  - Leer la **Ronda de Diseño ML** (`apps/ml-system-design`) completa sin atorarse.
  - Practicar en el **Dojo** (`apps/taller-ai`) sabiendo qué se hace y por qué.
  - Llegar a una entrevista con bases sólidas.
- **Idioma:** español de México, claro y directo. El término técnico en inglés va al lado del español la primera vez («función de pérdida (*loss*)»), porque es el que se usa en el trabajo y en las entrevistas.

## 2. Las reglas

1. **No asumir nada.** Cada concepto se explica antes de usarse, o en ese mismo momento. Si una palabra técnica aparece, o se explica ahí, o se marca como `[[id]]` del glosario, o ambas. Revisa cada párrafo preguntándote: «¿un chico de primer semestre sabría qué es esto?».
2. **Entender, no memorizar.** Cada idea importante responde tres preguntas: qué es, por qué existe (qué problema resuelve) y cómo se calcula o se usa. Si algo se puede calcular, se calcula a la vista.
3. **Analogías solo donde ayudan, nunca forzadas.** Una buena analogía tiene correspondencia clara y dice **dónde se rompe**. Si un ejemplo directo con números explica mejor, usa el ejemplo.
4. **Números concretos.** Cada idea abstracta lleva un ejemplo con números reales y pequeños, que se puedan seguir con lápiz. Muestra la cuenta.
5. **El caso C01 como hilo, sin encerrarse en él.** C01 es un marketplace que sugiere la categoría de la foto de una publicación: ≈ 2.5 M publicaciones al día, 500 categorías y una ResNet-50 servida con Triton en Kubernetes. Ana sube la foto de unos tenis. Úsalo cuando ayude. Además, muestra el concepto en **otros casos** (los 15 casos de la Ronda: video en tiempo real, OCR, búsqueda, recomendación, fraude, LLMs, RAG, agentes, voz, pronóstico, anuncios) y en la vida diaria, para que se entienda en general y no solo en un caso.
6. **Hechos verificados.** Nada de cifras inventadas. Si das un número (parámetros de un modelo, tamaño de un tipo de dato, una fecha), tiene que ser correcto. Si es una suposición para un ejemplo, dilo. Si no estás seguro, no lo des o dilo en forma aproximada y honesta. Cada cuenta se recalcula con un script antes de escribirla.
7. **Frases cortas.** Un párrafo es una idea. Sin relleno: más profundidad no es más palabras, es más ideas, más ejemplos y más práctica.
8. **Dos pasadas.** Lo esencial se entiende leyendo solo las secciones esenciales. Lo que profundiza va en secciones `[extra]` o en bloques `:::profundo`, para una segunda pasada.
9. **Puente con lo que sigue.** Cuando un concepto se usa mucho en la Ronda o en el Dojo, dilo: «En la Ronda lo vas a ver en M04, cuando calcule cuánta memoria de GPU necesita el modelo».

## 3. El estándar de una lección

Una lección completa trae todo esto. Los números son el piso, no el techo.

| Pieza | Mínimo | Para qué |
|---|---|---|
| Extensión | 7,000 a 10,000 palabras · lo esencial en ≈ 30–40 min, todo en ≈ 50–75 min (el build lo calcula con el texto, las piezas y los ejercicios) | Profundidad de curso, no de resumen |
| Secciones | 10 a 14, con al menos 2 marcadas `[extra]` | Dos pasadas |
| Diagramas (motor de la Ronda) | 2, cada uno con recorrido | Ver el flujo |
| Figuras SVG | 3 | Ver la idea |
| Calculadoras | 2 si el tema tiene cantidades (1 si es casi cualitativo) | Jugar con los números y sentir cómo cambian |
| Cuentas (`:::cuenta`) | 3 | La aritmética paso a paso |
| Código | 1 o más bloques de Python con su salida real (`salida`), si el concepto se calcula | Verlo funcionar en tu computadora |
| Errores comunes | Una sección esencial de 4 a 7 trampas, cada una con cómo evitarla | Lo que confunde en la práctica |
| En la vida real | Una sección con C01 y al menos 2 casos más, o ejemplos fuera de ML | Entenderlo en general |
| Ejercicios | Una sección esencial con 8 a 12 problemas (≈ 4 fáciles, ≈ 4 medios, 2 o 3 retos), con solución paso a paso | Practicar de verdad |
| Lo que sigue | Una sección con la Ronda (qué módulo lo usa y cómo), el Dojo si aplica y las lecciones siguientes | El puente |
| Palabras que vas a oír | `:::conceptos` con los ids que presenta la lección | El vocabulario |
| Chequeo | 5 a 7 preguntas rápidas | Repaso de un minuto |
| Glosario | Cada concepto con `corto`, `largo` y `ejemplo` (y `analogia` si ayuda) | El cuaderno único |

El orden recomendado es: idea, las secciones del tema (esenciales y extra intercaladas donde toque), «Errores comunes», «En la vida real», «Ejercicios», «Lo que sigue», «Palabras que vas a oír» y «Chequeo».

## 4. El archivo de una lección: `content/lecciones/<id>.md`

```
---
titulo: Qué es un modelo                  ← igual que en content/temario.json
en: What a model is                       ← el título en inglés
subtitulo: Una frase que dice qué vas a entender.
pregunta: La pregunta que responde la lección, como la haría el lector.
requisitos: camino-completo               ← opcional: ids de lecciones anteriores, separados por coma
---

:::idea
La idea de la lección en una o dos frases.
:::

## Título de la sección {English section title}

Texto…

## Una sección para la segunda pasada {Second-pass section} [extra]
```

- Cada `## Título {English}` es una sección numerada y esencial. Con `[extra]` al final se marca como extra.
- Los minutos de lectura los calcula el build con el texto, los diagramas, las calculadoras y los ejercicios. Ya no se escriben a mano.
- `### Subtítulo` se puede usar dentro de una sección.

### En línea

- `**negritas**`, `*itálicas*` y `` `código` ``.
- `[texto](url)`.
- `[[id]]` o `[[id|texto]]`: una palabra del glosario. Se subraya y abre su definición en un globo. Márcala la primera vez que aparece en cada sección importante, no todas las veces.

### Bloques

Cada bloque abre con `:::nombre` y cierra con `:::` solo en su línea.

| Bloque | Para qué |
|---|---|
| `:::idea` | La idea central en una o dos frases. Va al inicio de la lección. |
| `:::analogia Título` | Una analogía, con un párrafo final que diga dónde se rompe. |
| `:::ojo` | Una trampa o confusión común. |
| `:::nota Etiqueta` | Una aclaración al margen. |
| `:::ejemplo Título` | Un ejemplo con números, paso a paso. |
| `:::profundo Título` | Para ir más hondo. Va plegado y es opcional: la lección se entiende sin él. |
| `:::pasos` | Pasos numerados. Cada uno empieza con `1. Título` en su línea y sigue con su texto. |
| `:::cuenta Título` | Una cuenta paso a paso, como el bloque «calc» de la Ronda. Cada fila es `etiqueta \| expresión \| valor`; la etiqueta puede llevar `etiqueta // nota`; la línea `= texto` es el resultado. |
| `:::calculadora id` | Una calculadora de `content/calculadoras/<id>.json` (sección 7). El texto de adentro es su pie. |
| `:::diagrama id` | Un diagrama de `content/diagramas/<id>.json`. El texto de adentro es su pie. |
| `:::figura id` | Una figura de `content/figuras/<id>.svg`. El texto de adentro es su pie. |
| `:::ejercicios` | Problemas: `? [facil] pregunta`, `? [medio] …` o `? [reto] …`, y en las líneas siguientes la solución paso a paso (admite Markdown, cuentas y código). |
| `:::conceptos` | Los ids que **presenta** esta lección, separados por espacios. |
| `:::chequeo` | Preguntas rápidas: `? pregunta` y en las líneas siguientes la respuesta. |

Tablas con `| … |`. Dentro de una celda, `\n` parte la línea y `\|` es una barra. **Dentro de una tabla o de un `:::cuenta`, un enlace con texto va escapado: `[[id\|texto]]`**, porque el `|` sin escapar parte la celda.

**Código:** un bloque ` ```python ` va seguido de un bloque ` ```salida ` con lo que imprime **de verdad**: córrelo con `python3` antes de copiar la salida.
- Usa solo la **biblioteca estándar** (`math`, `statistics`, `random` con semilla, `struct`, `collections`): así el lector lo corre sin instalar nada. En la máquina donde se escribe no hay NumPy ni PyTorch.
- Si un concepto pide mostrar PyTorch o NumPy (por ejemplo `model.eval()`), va como ilustración **sin** bloque `salida`, y el texto lo dice.
- Que sea corto, de 3 a 25 líneas, y que se pueda copiar y correr tal cual.

**Ids de piezas:** los diagramas, figuras y calculadoras de una lección llevan su id como prefijo: `<lección>-<nombre>`, por ejemplo `modelo-softmax`. Así nadie pisa los archivos de otra lección.

## 5. El glosario: `content/glosario/<id-de-la-lección>.json`

Cada lección tiene su archivo con los conceptos que presenta:

```json
{ "terminos": [
  { "id": "softmax", "termino": "Softmax", "en": "softmax",
    "corto": "Una o dos frases: lo que sale en el globo. Debe entenderse solo, sin la lección.",
    "largo": "La explicación completa; puede usar [[otros-ids]].",
    "analogia": "Opcional.",
    "ejemplo": "Con números.",
    "ver": ["logit", "probabilidad"],
    "leccion": "modelo" }
]}
```

- `id` en minúsculas con guiones. Es único en todo el glosario.
- `leccion` es la lección donde se explica a fondo, que normalmente es la misma que lo presenta.
- Un concepto se presenta (en `:::conceptos`) en **una sola** lección. Si ya existe en otra lección, enlázalo con `[[id]]` y no lo vuelvas a crear.
- `content/conceptos-plan.json` dice qué lección presenta cada concepto planeado. Presenta los tuyos; si necesitas uno que no está en ningún lado, agrégalo a tu lección y dilo en tu reporte.
- Es válido enlazar con `[[id]]` un concepto que presenta una lección posterior: el globo trae su definición. Pero si la lección necesita entenderlo, explícalo ahí en una frase.

## 6. Diagramas: `content/diagramas/<id>.json`

Usan el motor de la Ronda (`vendor/ronda/diagram.js`). Se ven en una cuadrícula donde 1 unidad = 10 px, y la columna de lectura mide ≈ 78 unidades de ancho. **Usa `width` de 60 a 78** para que quepa sin deslizar; más ancho solo si de verdad hace falta (se desliza o se ve con «Ampliar»).

```json
{ "titulo": "Lo que muestra el diagrama",
  "width": 78, "height": 44,
  "lanes": [ { "id": "a", "label": "Texto del carril", "kind": "offline", "x": 0, "y": 0, "w": 78, "h": 20 } ],
  "nodes": [ { "id": "datos", "label": "Datos", "sub": "subtítulo corto", "badge": "1", "kind": "store",
               "x": 4, "y": 7, "w": 20, "h": 9,
               "note": "«Por qué está aquí»: 1 a 3 frases. Admite **negritas** y [[ids]]." } ],
  "edges": [ { "from": "datos", "to": "modelo", "kind": "offline", "label": "dataset",
               "fromSide": "r", "toSide": "l", "dashed": false, "via": [[50, 30]] } ],
  "flows": [ { "id": "vuelta", "label": "Una vuelta completa",
               "steps": [ { "nodes": ["datos"], "edges": [], "text": "Lo que pasa en este paso, con **negritas** en Markdown." } ] } ] }
```

- **Tipos de caja (`kind`)** y su forma: `client` (persona o app que pide), `edge` (puerta de entrada), `service` (programa), `model`, `gpu`, `store` (donde se guarda algo), `queue` (cola o registro), `job` (tarea que corre y termina), `monitor`, `external`, `human`.
- **Tipos de flecha:** `online` (azul: lo que pasa por cada petición), `offline` (ámbar: datos y entrenamiento), `monitor` (violeta), `async` (punteada) y `neutral`.
- **Carriles:** `online`, `offline`, `monitor` y `neutral`. Son bandas de fondo, horizontales o verticales. Elige el tipo por el significado (ámbar es datos y entrenamiento; azul, lo que pasa en cada petición).
- Las cajas miden normalmente `w` de 14 a 22 y `h` de 7 a 9. Deja de 8 a 12 unidades entre cajas si la flecha lleva etiqueta.
- Cada caja lleva su `note`: es lo que se lee al tocarla. Cada diagrama lleva al menos un recorrido (`flows`) que cuenta la historia paso a paso. Las llaves de flecha en `edges` de un paso son `"from>to"`.
- En los textos va **Markdown** (`**negritas**`, `[[id]]`), nunca etiquetas HTML.
- No pongas cajas encimadas ni fuera de `width`/`height`: el build lo revisa.

## 7. Calculadoras: `content/calculadoras/<id>.json`

Una calculadora es lo más cercano a experimentar: el lector mueve un control y ve el resultado al instante. Úsala donde jugar con un número enseña algo: cómo cambia el softmax con los logits, cuántas GPUs hacen falta con más tráfico, cómo sube la probabilidad de fallar con más servicios, cuánta memoria ocupa un modelo en cada tipo de dato.

```json
{ "titulo": "Softmax en vivo",
  "intro": "Mueve los tres [[logit|logits]] y mira cómo cambian las probabilidades.",
  "entradas": [ { "id": "a", "label": "Logit de **Tenis**", "min": -5, "max": 10, "paso": 0.1, "valor": 3 },
                { "id": "b", "label": "Logit de Botas", "min": -5, "max": 10, "paso": 0.1, "valor": 1 },
                { "id": "c", "label": "Logit de Sandalias", "min": -5, "max": 10, "paso": 0.1, "valor": 0 } ],
  "calculos": [ { "id": "ea", "formula": "exp(a)" }, { "id": "eb", "formula": "exp(b)" }, { "id": "ec", "formula": "exp(c)" } ],
  "salidas": [ { "label": "P(Tenis)", "formula": "ea / (ea + eb + ec)", "formato": "pct", "barra": true },
               { "label": "Suma de las exponenciales", "formula": "ea + eb + ec", "nota": "el denominador" } ],
  "nota": "Si sumas lo mismo a los tres logits, las probabilidades no cambian." }
```

- **Entradas:**
  - `min`, `max`, `paso` y `valor` inicial; `unidad` es opcional.
  - `"tipo": "numero"` usa una caja de número en vez de deslizador.
  - Pon como valor inicial el del ejemplo del texto, para que coincida.
- **Fórmulas:**
  - Son expresiones con los ids y con `exp`, `log` (natural), `log2`, `log10`, `sqrt`, `pow`, `min`, `max`, `abs`, `round`, `floor`, `ceil`, `PI` y `E`.
  - `calculos` son pasos intermedios con su propio id.
- **Formatos:** `num`, `int` (miles con coma), `pct` (multiplica por 100), `sci`, `bytes` (B, KB, MB… decimales), `ms` y `x` (veces). `decimales` es opcional. `barra: true` dibuja una barra (en `pct`, sobre 100 %).
- **Validación:** el build evalúa todas las fórmulas con los valores iniciales y con los extremos de cada entrada. Si alguna falla o no da un número, el build falla. Evita divisiones entre cero en los extremos; usa `max(x, 1e-9)` si hace falta.

## 8. Figuras: `content/figuras/<id>.svg`

Son dibujos hechos a mano en SVG para lo que un diagrama de cajas no explica bien: una imagen como cuadrícula de números, una curva de pérdida, una matriz de confusión o vectores en un plano.

- `viewBox` de **360 de ancho** (alto libre), pensado para leerse en el celular: el texto mide al menos 12 px.
- `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 H" role="img" aria-labelledby="f-<id>-t" class="f-svg" style="max-width:420px"><title id="f-<id>-t">Descripción completa para lectores de pantalla</title>…</svg>`.
- **Solo clases, sin colores fijos**, para que se vea en claro y en oscuro. Si falta un color, usa `style="fill:var(--o)"` o `style="stroke:var(--b)"` con los tokens.

| Clase | Uso |
|---|---|
| `f-card` | Tarjeta con borde |
| `f-chip` | Relleno suave |
| `f-dark` | Caja oscura (el modelo) |
| `f-t` | Texto fuerte, 15 px |
| `f-s` | Texto normal, 13 px |
| `f-l` | Etiqueta en mayúsculas, mono, 11 px |
| `f-dark-t`, `f-dark-l` | Texto sobre `f-dark` |
| `f-flecha` y `f-punta` | Línea y punta de flecha |
| `f-linea` | Solo trazo (línea o anillo) con el color de la tinta tenue |
| `f-o`, `f-y`, `f-g`, `f-b`, `f-p` | Rellenos naranja, amarillo, verde, azul y violeta |
| `f-b2` | Azul tenue |
| `f-off` | Gris apagado |
| `f-acc` y `f-acc-t` | Círculo de acento y su texto |
| `f-ink` | Relleno del color de la tinta |
| `f-knob`, `f-knob-i`, `f-giro`, `f-pill-t`, `f-cord` | Perillas, giro, texto sobre píldora azul y agujetas (ver `modelo-funcion.svg`) |

Ejemplos reales: `content/figuras/redes-convolucion.svg`, `content/figuras/imagenes-preproceso.svg` y `content/figuras/modelo-softmax.svg`.

## 9. Herramientas para revisar tu propia lección

- `node tools/build.mjs --solo <id>` arma solo tu lección en `.solo/<id>/`. Tolera que otras lecciones estén a medio escribir y acepta los `[[id]]` planeados en `content/conceptos-plan.json`. Imprime las palabras, los minutos y cuántas piezas trae.
- `node tools/vista.mjs <id>` toma una captura de cada figura, diagrama, calculadora y cuenta, en claro y en oscuro, a 375 px y a 780 px. Deja los PNG en `.solo/<id>/vistas/` e imprime sus rutas. **Ábrelos y míralos**: textos encimados, cosas cortadas, colores que no se leen en oscuro. Con `--filtro <nombre>` captura solo una pieza.
- `node tools/build.mjs` arma el sitio completo. Es lo que se publica.

## 10. Antes de dar una lección por terminada

- [ ] Cumple el estándar de la sección 3. `--solo` imprime las piezas y los minutos.
- [ ] Cada concepto técnico se explica antes de usarse o está marcado con `[[id]]`, y su id existe o está planeado.
- [ ] Cada cuenta, ejercicio y salida de código se recalculó con un script.
- [ ] Las analogías dicen dónde se rompen.
- [ ] Revisaste las capturas de `tools/vista.mjs` y nada se encima ni se corta.
- [ ] `node tools/build.mjs --solo <id>` pasa sin errores.
