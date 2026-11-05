# Guía de contenido de Sensei

Esta guía es para quien escribe lecciones de Sensei, sea una persona o Claude. Léela completa antes de escribir. El ejemplo vivo es `content/lecciones/camino-completo.md`.

## 1. Para quién y para qué

- **Lector:** alguien que apenas entra a la universidad. No sabe nada de ML, computadoras, redes, nube ni estadística. Es listo y tiene ganas, pero no conoce el vocabulario.
- **Meta:** que después de Sensei pueda leer la **Ronda de Diseño ML** (`apps/ml-system-design`) completa sin atorarse. La Ronda da por sabidos cientos de conceptos; Sensei los explica desde cero. También prepara para el **Dojo** (`apps/taller-ai`), donde se practica con código.
- **Idioma:** español de México, claro y directo. El término técnico en inglés va al lado del español la primera vez («función de pérdida (*loss*)»), porque es el que se usa en el trabajo y en las entrevistas.

## 2. Las reglas

1. **No asumir nada.** Cada concepto se explica antes de usarse, o en ese mismo momento. Si una palabra técnica aparece, o se explica ahí, o se marca como `[[id]]` del glosario, o ambas. Revisa cada párrafo preguntándote: «¿un chico de primer semestre sabría qué es esto?».
2. **Analogías solo donde ayudan, nunca forzadas.** Una buena analogía tiene correspondencia clara y dice **dónde se rompe**. Si un ejemplo directo con números explica mejor, usa el ejemplo.
3. **Números concretos.** Cada idea abstracta lleva un ejemplo con números reales y pequeños, que se puedan seguir con lápiz. Muestra la cuenta.
4. **El caso C01 como hilo:** un marketplace que sugiere la categoría de la foto de una publicación. Son ≈ 2.5 M publicaciones al día, 500 categorías y una ResNet-50 servida con Triton en Kubernetes. Ana sube la foto de unos tenis. Úsalo cuando ayude; no lo fuerces.
5. **Hechos verificados.** Nada de cifras inventadas. Si das un número (parámetros de un modelo, tamaño de un tipo de dato, una fecha), tiene que ser correcto. Si no estás seguro, no lo des o dilo en forma aproximada y honesta.
6. **Frases cortas.** Un párrafo es una idea. Sin relleno.
7. **Puente con la Ronda.** Cuando un concepto se usa mucho en la Ronda, dilo: «En la Ronda lo vas a ver en M04, cuando calcule cuánta memoria de GPU necesita el modelo».

## 3. El archivo de una lección: `content/lecciones/<id>.md`

```
---
titulo: Qué es un modelo                  ← igual que en content/temario.json
en: What a model is                       ← el título en inglés
subtitulo: Una frase que dice qué vas a entender.
pregunta: La pregunta que responde la lección, como la haría el lector.
minutos: 25
requisitos: camino-completo               ← opcional: ids de lecciones anteriores, separados por coma
---

:::idea
La idea de la lección en una o dos frases.
:::

## Título de la sección {English section title}

Texto…
```

- Cada `## Título {English}` es una sección numerada. Una lección suele tener de 5 a 9 secciones.
- Las dos últimas secciones son siempre `## Palabras que vas a oír {Words you will hear}` (con `:::conceptos`) y `## Chequeo {Check}` (con `:::chequeo`, de 4 a 6 preguntas). Si la lección prepara para módulos de la Ronda, antes de esas dos va `## Lo que sigue en la Ronda {Where the Ronda picks it up}`, con 2 a 5 viñetas que dicen qué módulo usa qué concepto.
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
| `:::diagrama id` | Un diagrama de `content/diagramas/<id>.json`. El texto de adentro es su pie. |
| `:::figura id` | Una figura de `content/figuras/<id>.svg`. El texto de adentro es su pie. |
| `:::conceptos` | Los ids que **presenta** esta lección, separados por espacios. |
| `:::chequeo` | Preguntas: `? pregunta` y en las líneas siguientes la respuesta. |

Tablas con `| … |`. Dentro de una celda, `\n` parte la línea y `\|` es una barra.

## 4. El glosario: `content/glosario/<id-de-la-lección>.json`

Cada lección tiene su archivo con los conceptos que presenta:

```json
{ "terminos": [
  { "id": "softmax", "termino": "Softmax", "en": "softmax",
    "corto": "Una o dos frases: lo que sale en el globo. Sin [[ ]] si se puede.",
    "largo": "Opcional: la explicación completa, puede usar [[otros-ids]].",
    "analogia": "Opcional.",
    "ejemplo": "Opcional, con números.",
    "ver": ["logit", "probabilidad"],
    "leccion": "modelo" }
]}
```

- `id` en minúsculas con guiones. Es único en todo el glosario.
- `leccion` es la lección donde se explica a fondo, que normalmente es la misma que lo presenta.
- Un concepto se presenta (en `:::conceptos`) en **una sola** lección. Si ya existe en otra lección, enlázalo con `[[id]]` y no lo vuelvas a crear.
- Es válido enlazar con `[[id]]` un concepto que presenta una lección posterior: el globo trae su definición. Pero si la lección necesita entenderlo, explícalo ahí en una frase.

## 5. Diagramas: `content/diagramas/<id>.json`

Usan el motor de la Ronda (`vendor/ronda/diagram.js`). Se ven en una cuadrícula donde 1 unidad = 10 px, y la columna de lectura mide ≈ 78 unidades de ancho. **Usa `width` de 60 a 78** para que quepa sin deslizar; más ancho solo si de verdad hace falta (se desliza o se ve con «Ampliar»).

```json
{ "titulo": "Lo que muestra el diagrama",
  "width": 78, "height": 44,
  "lanes": [ { "id": "a", "label": "Texto del carril", "kind": "offline", "x": 0, "y": 0, "w": 100, "h": 20 } ],
  "nodes": [ { "id": "datos", "label": "Datos", "sub": "subtítulo corto", "badge": "1", "kind": "store",
               "x": 4, "y": 7, "w": 22, "h": 9,
               "note": "«Por qué está aquí»: 1 a 3 frases. Admite **negritas** y [[ids]]." } ],
  "edges": [ { "from": "datos", "to": "modelo", "kind": "offline", "label": "dataset",
               "fromSide": "r", "toSide": "l", "dashed": false, "via": [[50, 30]] } ],
  "flows": [ { "id": "vuelta", "label": "Una vuelta completa",
               "steps": [ { "nodes": ["datos"], "edges": [], "text": "Lo que pasa en este paso." } ] } ] }
```

- **Tipos de caja (`kind`)** y su forma: `client` (persona o app que pide), `edge` (puerta de entrada), `service` (programa), `model`, `gpu`, `store` (donde se guarda algo), `queue` (cola o registro), `job` (tarea que corre y termina), `monitor`, `external`, `human`.
- **Tipos de flecha:** `online` (azul: lo que pasa por cada petición), `offline` (ámbar: datos y entrenamiento), `monitor` (violeta), `async` (punteada) y `neutral`.
- **Carriles:** `online`, `offline`, `monitor` y `neutral`. Son bandas de fondo, horizontales o verticales.
- Las cajas miden normalmente `w` de 14 a 22 y `h` de 7 a 9. Deja de 8 a 12 unidades entre cajas si la flecha lleva etiqueta.
- Cada caja lleva su `note`: es lo que se lee al tocarla. Cada diagrama lleva al menos un recorrido (`flows`) que cuenta la historia paso a paso. Las llaves de flecha en `edges` de un paso son `"from>to"`.
- No pongas cajas encimadas ni fuera de `width`/`height`: el build lo revisa.

## 6. Figuras: `content/figuras/<id>.svg`

Son dibujos hechos a mano en SVG para lo que un diagrama de cajas no explica bien: una imagen como cuadrícula de números, una curva de pérdida, una matriz de confusión o vectores en un plano.

- `viewBox` de **360 de ancho** (alto libre), pensado para leerse en el celular: el texto mide al menos 12 px.
- `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 H" role="img" aria-labelledby="f-<id>-t" class="f-svg" style="max-width:420px"><title id="f-<id>-t">Descripción completa para lectores de pantalla</title>…</svg>`.
- **Solo clases, sin colores fijos**, para que se vea en claro y en oscuro. Si falta un color, usa `style="fill:var(--o)"` con los tokens.

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
| `f-linea` | Solo trazo (línea o anillo) con el color de la tinta tenue; para otro color, `style="stroke:var(--b)"` |
| `f-o`, `f-y`, `f-g`, `f-b` | Rellenos naranja, amarillo, verde y azul (las etapas) |
| `f-b2` | Azul tenue |
| `f-off` | Gris apagado |
| `f-acc` y `f-acc-t` | Círculo de acento y su texto |
| `f-ink` | Relleno del color de la tinta |
| `f-knob` y `f-knob-i` | Perillas |

Ejemplos reales: `content/figuras/modelo-funcion.svg` y `content/figuras/dos-momentos.svg`.

## 7. Antes de dar una lección por terminada

- [ ] Cada concepto técnico se explica antes de usarse o está marcado con `[[id]]`, y su id existe.
- [ ] Hay al menos un diagrama con recorrido y al menos una figura.
- [ ] Hay al menos un ejemplo con números y la cuenta a la vista.
- [ ] Las analogías dicen dónde se rompen.
- [ ] Las cifras son correctas.
- [ ] `node tools/build.mjs` pasa sin errores.
