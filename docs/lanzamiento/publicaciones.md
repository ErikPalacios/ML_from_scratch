# Borradores de publicaciones

Textos listos para adaptar con tu voz. **No he publicado nada.** Antes de cada uno, cambia lo que sea falso para ti y agrega la cifra real de tu beta si la tienes. Las capturas están en `docs/img/` (portada, hojas, atlas, transformer, tablero, curso).

**Orden sugerido:** semana 0 beta → día L: LinkedIn + X → día L+1: Reddit (en inglés) → después de 2–3 semanas con la portada en inglés lista: Show HN. Una publicación por plataforma; el resto de la semana, un contenido corto (sección 6).

## 1. LinkedIn (español)

> Pasé los últimos meses preparándome para entrevistas de ML Engineer y terminé construyendo mis propias herramientas de estudio. Hoy las abro, gratis y sin cuenta:
>
> 📘 Ronda de Diseño ML: curso y simulador de ML System Design, con práctica cronometrada de 45 minutos.
> 📄 Cheat sheets: Docker (con laboratorio completo), Kubernetes, Git y Actions, Triton, FastAPI, Prometheus y vLLM, con PDF.
> 🧭 Atlas de Arquitecturas: ViT, CLIP, DETR, SAM, LLMs… con dimensiones, parámetros y FLOPs a la vista.
> 🧪 Laboratorio Transformer: un transformer pequeño entrenándose operación por operación en tu navegador.
> 🗺️ Un tablero de proyectos ML (hay demo).
>
> Casi todo funciona sin conexión y se lee bien en el celular. Está en español, con los términos técnicos en inglés como se dicen en la entrevista.
>
> Cómo se hizo: con Claude Code, verificando comandos y cifras contra la documentación oficial; los revisores (Dockerfile, YAML, workflows) corren en tu navegador. El código es abierto.
>
> Si estás preparando una entrevista, pruébalo y cuéntame qué falla o qué te falta: https://ml-desde-cero.vercel.app
>
> #MachineLearning #MLOps #MLEngineering #Entrevistas

*Imagen:* `docs/img/portada.png`. *Primer comentario:* el enlace al repositorio.

## 2. X (hilo, español)

1. Armé herramientas gratis para prepararte como ML Engineer: curso de system design, hojas de Docker/K8s/vLLM, un atlas de arquitecturas y un transformer que se entrena paso a paso. Sin cuenta y casi todo sin conexión. 🧵 https://ml-desde-cero.vercel.app
2. 📘 Ronda de Diseño ML: lo que rodea al modelo en producción (serving, datos, evaluación, monitoreo, costo), con práctica cronometrada de 45 min y rúbrica. https://ronda-diseno-ml.vercel.app
3. 📄 Cheat sheets: 9 hojas con PDF. Docker trae un laboratorio completo, un generador de Dockerfile y un revisor que corre en tu navegador. https://cheat-sheets-ml.vercel.app
4. 🧭 Atlas de Arquitecturas: ViT, CLIP, DETR, SAM, LLMs… con diagrama, matemáticas, dimensiones y la cuenta de parámetros y FLOPs a la vista. https://atlas-arquitecturas.vercel.app
5. 🧪 Laboratorio Transformer: forward, pérdida, backward y actualización, operación por operación, con cada matriz y su fórmula. Todo se calcula en tu navegador. https://laboratorio-transformer.vercel.app
6. Es código abierto y está hecho con Claude Code. Si encuentras un error o te falta algo, abre un comentario: https://github.com/ErikPalacios/ML_from_scratch/issues/new/choose

## 3. Reddit (inglés) — r/learnmachinelearning o r/mlops

**Antes de publicar, lee las reglas de autopromoción de cada subreddit** (muchos exigen participación previa o un día específico). Publica en uno a la vez.

**Título:** I built free, offline-friendly study tools for ML engineer interviews (Spanish): system design course, cheat sheets, architecture atlas, a transformer trained step by step in the browser

> Hi all. I'm preparing for ML Engineer interviews and ended up building my own study tools. I'm sharing them in case they help someone else. They're in Spanish (technical terms in English), free, no signup, and most of it works offline:
>
> - **ML System Design course + simulator** (timed 45-minute practice, rubric): https://ronda-diseno-ml.vercel.app
> - **Cheat sheets** (Docker with a full lab, Kubernetes, Git/Actions, Triton, FastAPI, Prometheus, vLLM) with in-browser linters: https://cheat-sheets-ml.vercel.app
> - **Architecture atlas** (ViT, CLIP, DETR, SAM, LLMs…, with shapes and param/FLOP counts shown): https://atlas-arquitecturas.vercel.app
> - **Transformer lab**: a small GPT-style model trained one operation at a time, forward and backward written by hand in JS: https://laboratorio-transformer.vercel.app
>
> Everything is static, MIT for code and CC BY-NC-ND for the content. Built with Claude Code, with figures checked against official docs. Repo: https://github.com/ErikPalacios/ML_from_scratch
>
> I'd really like to hear what's confusing or wrong, especially from native Spanish speakers or anyone doing interviews right now.

## 4. Show HN (inglés) — esperar a tener la portada en inglés

**Título:** Show HN: A transformer that trains step by step in your browser (forward and backward, no ML libs)

> I wrote a small GPT-style transformer in plain JavaScript (forward, loss, backward, optimizer update) and built a UI that walks through one training iteration operation by operation: every matrix, its formula and its shape, with a cell inspector that shows the exact arithmetic. No libraries, everything runs client-side, works offline.
>
> It's part of a set of free study tools for ML engineer interviews (in Spanish): https://ml-desde-cero.vercel.app. The lab is at https://laboratorio-transformer.vercel.app.
>
> Content is Spanish; the math and diagrams are readable regardless. Feedback welcome on the explanations and on anything that's wrong.

Show HN pide que se pueda probar sin registro (cumple) y que quien lo publica esté disponible para responder durante las primeras horas. El laboratorio está en español: si el idioma es un obstáculo para esa audiencia, conviene esperar a la portada en inglés.

## 5. Mensajes cortos por app (WhatsApp, Discord, Telegram)

- **Curso:** «Armé un curso gratis con simulador para la ronda de ML System Design. Práctica de 45 min con rúbrica: https://ronda-diseno-ml.vercel.app»
- **Hojas:** «Cheat sheets de Docker, Kubernetes, vLLM y más, con PDF y revisores en el navegador: https://cheat-sheets-ml.vercel.app»
- **Atlas:** «Atlas de arquitecturas de ML (ViT, CLIP, DETR, SAM, LLMs) con dimensiones y FLOPs: https://atlas-arquitecturas.vercel.app»
- **Laboratorio:** «Un transformer entrenándose paso a paso en tu navegador, con cada matriz y fórmula: https://laboratorio-transformer.vercel.app»

## 6. Contenido corto semanal (después del lanzamiento)

Una pieza por semana, tomada de lo que ya existe, con captura y enlace a la hoja:
1. Un error de Docker del quiz y su arreglo.
2. Una figura de Kubernetes o vLLM explicada en 4 líneas.
3. Un cálculo de estimaciones del caso C01 (de QPS a número de GPUs).
4. Un paso del laboratorio Transformer (por ejemplo, la atención o el softmax).
5. «Lo que aprendí lanzando esto con Claude Code»: contratiempos reales (costos, despliegues, un cruce de proyectos en Vercel, un error de sintaxis que las pruebas no cubrían).

## 7. Lista antes de publicar

- [ ] La beta cerró sin fallas graves.
- [ ] Tienes permiso por escrito (un mensaje basta) de cada persona que vayas a citar.
- [ ] Probaste el enlace compartido: se ve la imagen y el título.
- [ ] Estás disponible las primeras 3 a 4 horas para responder comentarios.
- [ ] Web Analytics activado, para saber si hubo visitas.
- [ ] Sabes qué harás si hay una falla grave el día del anuncio (revisar comentarios, corregir y redesplegar el mismo día).
