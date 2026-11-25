# IA Privada

La app de TrueML para **AI systems engineering**: llevar modelos open weight al hardware propio de una empresa. Trae lecciones, herramientas (calculadoras) y casos; su práctica es la rama `ia-privada` del Dojo. El plan completo está en [docs/plan-ia-privada.md](../../docs/plan-ia-privada.md).

«IA Privada» es el nombre de trabajo: vive solo en `content/sitio.json`.

## Cómo está hecha

Es el armazón de Sensei (`apps/sensei`), con lo mismo: el formato de lectura, el Markdown con sus bloques (`tools/md.mjs`), el glosario con globos, el motor de diagramas y el de calculadoras. Sin dependencias.

```bash
node tools/build.mjs        # arma dist/
node tools/check.mjs        # anchos (375, 768, 1024 y oscuro), tema, globos, calculadoras y modo sin conexión
```

| Carpeta | Qué hay |
|---|---|
| `content/sitio.json` | Nombre, dirección y textos de la portada |
| `content/temario.json` | Los 11 módulos y sus lecciones, con las lecciones de Sensei que cada uno da por leídas |
| `content/herramientas.json` · `content/herramientas/<id>.md` | Las herramientas; cada una es una página con su calculadora y sus conceptos |
| `content/casos.json` | Los 6 casos de dimensionamiento |
| `content/calculadoras/<id>.json` | Las calculadoras (formato de Sensei más listas, preajustes, cuenta paso a paso y veredicto: ver `tools/calculadora.mjs`) |
| `content/glosario/<id>.json` | Los conceptos que presenta cada página; `sensei` enlaza su lección a fondo |
| `content/datos/gpus.json` · `content/datos/sensei.json` · `content/dojo.json` | **Generados** por `apps/trueml/sync.mjs`: las GPUs de Sensei (la única fuente), los títulos de Sensei y la rama del Dojo. No se editan a mano |

Una calculadora toma las GPUs con `"opciones": "gpus"` y `"inicial": "<id de gpus.json>"`: ningún número de una GPU se escribe a mano.

## Publicación

Proyecto de Vercel `ia-privada`, conectado a Git, Root Directory `apps/ia-privada`: cada push a `main` lo publica en https://ia-privada.vercel.app. El subdominio de trueml.app se agrega cuando haya nombre final.
