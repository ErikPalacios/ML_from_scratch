# Sensei

Es la teoría de cada paso para llevar un modelo de AI o ML a producción, explicada desde cero, como a alguien que apenas entra a la universidad. Trae diagramas, analogías donde ayudan y una misma empresa ficticia de principio a fin: **Alba**, un marketplace que sugiere la categoría de cada foto. Sus números viven en `content/empresa.json`. Las palabras del glosario abren su definición ahí mismo, sin salir de la página. El plan completo está en [docs/plan-sensei.md](../../docs/plan-sensei.md).

Es la capa de **entender**. El [Dojo](../taller-ai) es la de **practicar** y la [Ronda de Diseño](../ml-system-design) la de **defender** el diseño en una entrevista. La meta es que, después de Sensei, la Ronda se lea completa sin atorarse. Pero **Sensei es independiente**: las lecciones nunca nombran la Ronda, el Dojo ni sus códigos (M01–M15, C01–C15). Los dos aparecen solo en la página final, «¿Qué sigue después de Sensei?» (`/que-sigue/`, que reemplaza a `/ronda/`), y en la tarjeta de la estación del Dojo al cierre de una lección.

El formato de lectura es el de la Ronda: barra lateral con el índice, la lección como una hoja con secciones numeradas y «En esta página». Los diagramas usan el motor de la Ronda.

**Para escribir una lección, lee primero [GUIA-CONTENIDO.md](GUIA-CONTENIDO.md).**

## Estructura

| Carpeta o archivo | Qué es |
|---|---|
| `content/sitio.json` | Nombre, dirección y textos de la portada. El nombre de la app se cambia aquí. |
| `content/temario.json` | Los módulos y sus lecciones, en orden de lectura. Una lección existe cuando está su `.md`; mientras no, sale como «próximamente» con su fase. |
| `content/empresa.json` | La ficha de Alba, la empresa del curso: cada número que usan las lecciones, con su nota y las lecciones que lo usan. |
| `content/ronda.json` | Los 15 módulos de la Ronda (de su `catalog.js`) y las lecciones que conviene repasar antes de cada uno. Solo lo usa `/que-sigue/`. |
| `content/glosario/<lección>.json` | Los conceptos que presenta cada lección. El build los junta y falla si uno se repite. |
| `content/lecciones/<id>.md` | Cada lección: un encabezado `---` con `titulo`, `subtitulo`, `pregunta`, `minutos` y `requisitos` opcionales, y el cuerpo en Markdown con los bloques de `tools/md.mjs`. |
| `content/diagramas/<id>.json` | Diagramas en el formato del motor de la Ronda (carriles, cajas, flechas y recorridos; ver `tools/diagrama.mjs` y la guía). |
| `content/figuras/<id>.svg` | Figuras hechas a mano, con las clases `f-*` de `site/sensei.css` para que se vean en claro y en oscuro. Diseñadas a 360 px de ancho para leerse en el celular. |
| `content/dojo.json` | Las estaciones del Dojo y cuáles ya están listas. Lo escribe `node apps/trueml/sync.mjs`; no se edita a mano. |
| `vendor/trueml/`, `vendor/ronda/` | Copias del sistema de diseño TrueML y del motor de diagramas de la Ronda (`diagram.js` y `components.css`). Las escribe `node apps/trueml/sync.mjs`; no se editan a mano. |
| `site/` | Estilos, script, service worker, ícono e imagen para redes. |
| `tools/` | `build.mjs`, `md.mjs`, `diagrama.mjs` y `check.mjs`. |

## Cómo se escribe una lección

- `[[id]]` o `[[id|texto]]` marca una palabra del glosario: se subraya y abre su globo.
- Secciones: `## Título {English title}` abre una sección numerada.
- Bloques: `:::idea`, `:::analogia Título`, `:::ojo`, `:::nota Etiqueta`, `:::ejemplo Título`, `:::profundo Título` (opcional, plegado), `:::pasos`, `:::diagrama id`, `:::figura id`, `:::conceptos` y `:::chequeo`. Cada uno se cierra con `:::` solo en su línea. Lo que va dentro de `:::diagrama` y `:::figura` es su pie.
- `:::conceptos` lista los ids que la lección **presenta**. Cada concepto se presenta en una sola lección. En su entrada del glosario, `leccion` dice dónde se ve a fondo, aunque esa lección todavía no exista.
- `:::chequeo`: `? pregunta` y debajo la respuesta.
- En una tabla, `\n` parte la línea dentro de una celda y `\|` es una barra literal.

El build falla si un `[[id]]` no existe, si un concepto se presenta dos veces o si falta un diagrama o una figura. También lista los **adelantos**: palabras que una lección usa antes de que alguna lección las presente. Salen en su globo con la definición, pero conviene que sean pocas.

**La regla de las dudas:** cuando surja una duda en el Dojo o en la Ronda, la respuesta se agrega o se mejora en `content/glosario/` (sin nombrar de dónde vino).

## Comandos

```bash
npm run build   # arma dist/
npm run check   # build + Chrome headless: 375/768/1024 px, oscuro, tema, globos y modo sin conexión
```

`check` usa `apps/ml-system-design/tools/browser-check.mjs`. El build no depende de otras carpetas: se puede desplegar desde aquí.

## Despliegue

Es un proyecto de Vercel propio, sin Git conectado, como las otras apps. Se despliega desde esta carpeta con `vercel deploy --prod`, y `vercel.json` hace el build sin instalar nada y publica `dist/`. La dirección prevista es https://sensei-ml.vercel.app. Si cambia, cámbiala en `content/sitio.json`, en `apps/portada/site.json` y en `apps/portada/tools/og.mjs`.

La imagen para redes sale de `node tools/og.mjs sensei` (desde `apps/portada`), y el ícono de `node apps/trueml/iconos.mjs sensei`.
