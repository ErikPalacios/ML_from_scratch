# Ronda de Diseño ML

Curso y simulador para la ronda de **ML System Design** de las entrevistas de **ML Engineer**.
No explica modelos: explica todo lo que los rodea cuando van a producción —serving, datos,
evaluación, despliegue, monitoreo, fallas y costo— como lo evalúa un entrevistador.

Está pensada para alguien fuerte en teoría de ML/DL y visión por computadora (PyTorch) que todavía
no ha llevado un modelo a producción. El texto está en español; los términos técnicos, en inglés,
tal como se dicen en la entrevista.

La app se construye por fases. **Fase 1** (esta): toda la estructura, el módulo **M01** completo, el
caso **C01** completo (con archivos de referencia reales), el simulador, las flashcards y el glosario.
El resto de los módulos y casos aparece en el índice como **Próximamente**, con su resumen y, en los
casos, su enunciado, que ya puedes practicar.

## Cómo abrirla

**Opción 1: doble clic.** Abre `index.html` en el navegador (Chrome, Edge, Firefox o Safari).
Funciona desde el disco (`file://`), sin servidor ni instalación. Necesita las carpetas `css/` y
`js/` al lado del `index.html`.

**Opción 2: un solo archivo.** Con Node ≥ 20:

```bash
npm run build          # = node tools/embed-reference.mjs && node build.mjs
```

Genera dos archivos en `dist/`:

| archivo | para qué |
|---|---|
| `dist/ml-system-design.html` | la app completa en un solo HTML autocontenido (~8.5 MB). Cópialo a donde quieras y ábrelo con doble clic. |
| `dist/artifact.html` | el mismo contenido sin `<!doctype>`, `<html>`, `<head>` ni `<body>` (empieza con `<title>`), para publicarlo como **Artifact de claude.ai**. |

El único recurso externo son las fuentes IBM Plex de Google Fonts; sin conexión, la app usa las
fuentes del sistema y funciona igual.

## Las cuatro partes

| parte | qué hay | estado en la fase 1 |
|---|---|---|
| **1 — Fundamentos** | 15 módulos (M01–M15): el mapa de la entrevista, patrones de inferencia, latencia y capacidad, hardware, contenedores, orquestación, model servers, optimización, datos y features, MLOps, despliegue seguro, monitoreo, nube, LLMs, seguridad. | M01 completo; el resto, Próximamente |
| **2 — Casos de diseño** | 13 casos (C01–C13). Cada uno sigue la misma plantilla de 15 secciones: enunciado, preguntas de aclaración, requisitos, estimaciones, arquitectura, datos, serving, evaluación, monitoreo, fallas, trade-offs, costo, archivos de referencia, preguntas de seguimiento y checklist final. | C01 completo; los demás con enunciado practicable |
| **3 — Práctica** | **Simulador** de 45 minutos con reloj, framework de 7 pasos que te dice en qué paso deberías ir, autoguardado, rúbrica de 6 dimensiones y resultado con tus puntos débiles; **Historial** de intentos; **Flashcards** con repetición espaciada (Leitner, 5 cajas). | completo |
| **4 — Referencias** | **Glosario ES–EN** con buscador y frase de ejemplo en inglés; hojas de números, herramientas por categoría y comandos de Docker/kubectl. | glosario completo; las hojas, Próximamente |

Cada caso tiene una **compuerta de práctica**: antes de tu intento cronometrado solo ves el enunciado
ambiguo del entrevistador; la solución (y sus números) se muestra después (o si eliges verla sin
practicar). Las flashcards de un caso también se desbloquean entonces, porque sus respuestas son la
solución. El ciclo recomendado está en el Inicio: módulo → flashcards →
caso con reloj → rúbrica → solución.

**Atajos de teclado:** `/` busca · `[` y `]` página anterior/siguiente del curso · `Esc` cierra
paneles. En flashcards: `Espacio` muestra la respuesta, `1` / `2` / `3` califican.

**Opción 3: en la web (Vercel), para celular y tablet.** `npm run build:web` arma `dist/web/`: el
mismo HTML como `index.html`, más un manifest, íconos y un service worker. En el celular o la tablet
puedes **agregarla a la pantalla de inicio** (iPhone/iPad: Safari → Compartir → "Agregar a inicio";
Android: Chrome → menú → "Instalar app") y, **después de abrirla una vez con internet, funciona sin
conexión**. Cada deploy nuevo reemplaza la copia guardada la siguiente vez que la abras con internet.
La app ya está pensada para pantallas de 360 px en adelante.

Para subirla, usa una de estas dos formas:

- **Con Git:** sube el repositorio a GitHub, impórtalo en Vercel (Add New → Project) y en **Root
  Directory** pon `apps/ml-system-design`. El resto lo toma de `vercel.json`: sin framework, sin
  instalar dependencias, build `npm run build:vercel` y salida `dist/web`. En Vercel no se vuelve a
  incrustar `reference/`: se usa el `js/content/reference-files.js` commiteado (corre
  `npm run embed` y commitea si cambias algo en `reference/`; `npm test` avisa si quedó viejo).
- **Con la CLI**, desde esta carpeta: `npx vercel` (preview) y luego `npx vercel --prod`.
  `.vercelignore` deja fuera lo que no hace falta (`reference/`, tests, docs).

En la web el progreso se guarda **en el navegador de cada dispositivo** ("Guardado en este navegador").
Para pasarlo del celular a la tablet o desde el Artifact, usa **Exportar / importar progreso**.

## Practicar un módulo

M01 tiene un botón **Practicar M01** (al inicio y al final del módulo) que abre `#practicar-m01`:
rondas de 10 preguntas difíciles, 6 de opción múltiple y 4 cálculos. Los cálculos cambian los números
en cada ronda y aceptan ±15 % (el número de GPUs, exacto). Cada respuesta muestra la explicación y
la sección que conviene releer. Los botones **Formulario**, **Notas rápidas** y **Mis notas** abren un
panel a la derecha sin salir de la ronda. El banco vive en `js/content/m01-practica.js` (preguntas y
notas rápidas) y `js/content/m01-practica-calc.js` (formulario y plantillas de cálculo); otro módulo
se agrega con sus propios archivos `mNN-practica*.js` y el botón aparece solo.

## Banco de problemas

**Banco de problemas** (Parte 3 del índice, `#problemas`) da un problema tras otro con números
nuevos. La primera sección es **Estimaciones** (tráfico, latencia, disponibilidad, hardware, costo,
almacenamiento y red, y escenarios completos encadenados), más dos temas de casos completos de
entrevista: **Diseña un proyecto** («queremos lograr esto, ¿qué haces?»: requisitos → patrón o
hardware → tamaño → trade-off con números) y **Arregla o mejora** («tenemos este problema, ¿cómo lo
arreglas?»: síntomas del dashboard → causa raíz → arreglo → impacto). Cada tema tiene 3 niveles; en
modo **Auto**, 3 aciertos seguidos sin pista suben de nivel y 2 fallos lo bajan (también puedes fijar
el nivel). **Pista** muestra cómo plantearlo sin los números; cada parte se corrige al momento con la
solución paso a paso, y al final se explica qué decide ese número en el diseño. Si cambias de tema o
de nivel a media pregunta, el problema cambia en ese momento sin contarse; **Saltar problema** da
otro, **Reiniciar sesión** pone los contadores en cero y **Reiniciar niveles** (con confirmación)
regresa todos los temas a nivel 1. **Formulario** y **Números de referencia** se abren a la derecha.
Las secciones viven en `js/content/banco-*.js` (`MSD.problemBank.<id>`: temas, fórmulas, tarjetas y
plantillas `gen(r)`); una sección nueva aparece sola en la página, y un archivo puede sumar temas a
una sección existente si se carga después de ella (`banco-proyectos.js` suma los dos temas de casos a
Estimaciones).

La segunda sección es **Casos de diseño** (`#problemas.casos`): casos completos de entrevista con
requisitos concretos (volumen, latencia, presupuesto, frescura). Eliges el patrón, estimas, dimensionas,
comparas contra el presupuesto y defiendes el trade-off. Los temas siguen los patrones de M2, en orden de
lo que más se ve en trabajos reales: Online síncrono, Batch, Asíncrono con colas, LLMs y RAG, Híbridos,
Streaming y Edge. Todos tienen nivel 1 para empezar. `banco-casos.js` define la sección (temas, tarjetas
de referencia y utilidades en `B.util`) y cada tema vive en su archivo `banco-casos-<tema>.js`, cargado
después.

## Tus notas

Al final de cada sección hay un botón **Agregar nota**: escribe una duda, un resumen o un **término
con tu propia definición** (p. ej. qué es TLS o un load balancer). Las notas se quedan en esa sección,
y **Mis notas** (Parte 3 del índice) las junta todas, agrupadas por página, con búsqueda, edición y
borrado. Tus términos salen también en el glosario (marcados «Mío»), en el buscador y como flashcards.
No modifican el contenido del curso: se guardan con tu progreso y viajan con Exportar / importar.
Mientras lees, la barra flotante de abajo a la derecha tiene **Nota** (agrega una nota en la sección
que estás leyendo, sin volver al final) y **Ver notas**, que abre un panel a la izquierda con las notas
de la página. El índice **En esta página** se puede plegar para darle más ancho al contenido.

## Cómo se guarda tu progreso

El estado (secciones leídas, módulos completados, checklists, intentos con su texto, flashcards,
tus notas y preferencias) vive en memoria y se guarda en dos niveles. El pie de la barra lateral te dice cuál se
está usando:

- **"Guardado en este navegador"**: `localStorage`, clave `msd.v1`. Es por navegador y por equipo: en
  otro navegador, en otra computadora o tras borrar los datos del sitio empiezas de cero. Si el JSON
  guardado se corrompe, se respalda en `msd.v1.corrupto` y la app arranca limpia.
- **"Guardado en tu cuenta"**: cuando la app corre como Artifact de claude.ai **publicado con las
  capabilities `{db:{}, user:{}}`**, el progreso se sincroniza con un documento privado de tu cuenta
  (`data/users/<tu id>/state`, con un documento por intento). Solo tú lo ves. Al abrir, se fusiona con
  lo local: en cada dato gana la versión más reciente. Si la cuenta no responde, sigue en local.
- **"Sin guardado"**: el navegador no permite almacenamiento (p. ej. algunos modos privados). El
  progreso se pierde al cerrar.

Puedes tener la app abierta en varias pestañas: antes de guardar, cada una fusiona lo que guardaron las
otras (en cada dato gana lo más reciente), así que ninguna borra el intento o el progreso de otra.

Para moverte entre equipos o hacer un respaldo: **Exportar / importar progreso** (pie de la barra
lateral). Exportar muestra el JSON para copiarlo; importar lo fusiona con lo que ya tienes, sin borrar
nada.

## Cómo agregar un módulo o un caso (fases siguientes)

El shell no se toca: cada módulo o caso es un archivo de contenido que se registra solo. El catálogo
(`js/content/catalog.js`) ya tiene los 28 ítems con título, resumen, temas y conexiones; en cuanto un
archivo registra contenido, la página deja de ser Próximamente (un módulo, con al menos una sección;
un caso, con sus 15 secciones).

1. **Crea el archivo** `js/content/<id>-<tema>.js` (por ejemplo `js/content/m02-patrones.js` o
   `js/content/c02-video.js`) con este esqueleto. El formato completo está en `docs/SPEC.md` §5–§6 y
   `m01-mapa.js` / `c01-clasificacion.js` son ejemplos reales.

   ```js
   (function (root) {
     'use strict';
     const MSD = (root.MSD = root.MSD || {});
     MSD.register({
       id: 'm02', kind: 'module',
       sections: [
         { id: 'online-vs-batch', title: 'Online vs batch', titleEn: 'Online vs batch inference', priority: 'core',
           dims: ['arquitectura'],
           blocks: [ { t: 'p', html: '…' }, { t: 'callout', kind: 'trap', html: '…' } ] },
       ],
       flashcards: [ { id: 'm02-01', q: '…', a: '…', kind: 'concepto' } ],
       glossary: [ { en: 'batch inference', es: 'inferencia por lotes', def: '…', say: '…' } ],
     });
   })(typeof window !== 'undefined' ? window : globalThis);
   ```

   `dims` (opcional) dice qué dimensiones de la rúbrica trabaja la sección; el resultado de la práctica
   enlaza ahí las dimensiones débiles.

   **Los `id` son claves de tu progreso guardado:** secciones, checklists y sus ítems, flashcards y puntos
   de rúbrica. Nunca los renombres ni los reutilices en una página ya publicada. Para cambiar un título,
   cambia `title`. Para quitar una tarjeta o un ítem, bórralo y no reasignes su id. Numera las tarjetas
   nuevas a continuación de la última (`m01-31`, …).

   **Glosario:** los términos se fusionan por `en` (sin distinguir mayúsculas). Gana el `es`, la `def` y
   el `say` del primer archivo que carga `index.html`; repetir el término en otra página solo añade el
   chip de esa página. Para corregir una definición, edítala donde se definió primero. Escribe cada
   término con la misma grafía que ya tiene (`KV cache`, no `KV-cache`): dos grafías con el mismo slug
   son un error del validador.

   Un **caso** usa `kind: 'case'`, agrega `specs` (4–6 pares para la tira de datos), `rubric` (puntos
   clave por dimensión: `aclaracion`, `estimaciones`, `arquitectura`, `tradeoffs`, `monitoreo`,
   `comunicacion`) y exactamente las 15 secciones de la plantilla (`enunciado`, `aclaracion`,
   `requisitos`, `estimaciones`, `arquitectura`, `datos`, `serving`, `evaluacion`, `monitoreo`, `fallas`,
   `tradeoffs`, `costo`, `archivos`, `seguimiento`, `checklist`). Puedes partirlo en dos archivos: el
   principal registra 14 secciones y otro llama `MSD.addSection('cNN', { id: 'archivos', … })`, como
   `c01-archivos.js`.

   El archivo no debe tocar `document` ni `window` al cargar: el validador lo ejecuta en Node.

2. **Agrega la línea `<script>` en `index.html`**, justo debajo del comentario
   `<!-- contenido: añade aquí los módulos/casos nuevos -->` y **antes** de `js/app.js`:

   ```html
   <!-- contenido: añade aquí los módulos/casos nuevos -->
   <script src="js/content/m02-patrones.js"></script>
   <script src="js/app.js"></script>
   ```

   `build.mjs` incrusta todo lo que `index.html` carga, así que no hay que tocar nada más.
   `npm run validate` falla si un archivo de `js/content/` no está en `index.html` o está después de
   `js/app.js`, y carga el contenido en el mismo orden que la app.

3. **Archivos de referencia** (si el caso los tiene): ponlos en `reference/<id>/…` (archivos reales,
   que se puedan ejecutar) y regenera el embebido:

   ```bash
   node tools/embed-reference.mjs      # reference/** → js/content/reference-files.js (generado, no se edita)
   ```

   En el contenido, un bloque de código los referencia con `src` relativo a `reference/`:
   `{ t: 'code', files: [ { name: 'app/main.py', lang: 'python', src: 'c02/app/main.py' } ] }`.

4. **Hoja de ruta:** en `catalog.js`, cambia el `status` de la fase (`'done'` / `'next'` / `'later'`).
   El validador falla si marcas `'done'` una fase con ítems sin contenido y avisa si todos sus ítems
   ya tienen contenido y sigue sin `'done'`.
   Una hoja de la parte 4 (`ref-numeros`, `ref-herramientas`, `ref-comandos`) se registra igual que un
   módulo: `MSD.register({ id: 'ref-numeros', kind: 'special', sections: […] })`, con flashcards
   `ref-numeros-01…` si las hay. Deja de ser Próximamente en cuanto registra al menos una sección; no se
   toca el catálogo. El shell la pinta como un módulo (secciones, marcas de lectura, índice de la página),
   sin contar en el progreso del curso.

5. **Verifica:**

   ```bash
   npm run validate        # esquema, plantilla, enlaces internos, diagramas, código: 0 errores
   npm test                # validador + archivos embebidos al día + pruebas del store
   npm run smoke           # recorrido completo en Chrome headless (escritorio, claro)
   npm run smoke:mobile    # 375 × 812, con cajón
   npm run smoke:dark      # tema oscuro
   npm run smoke:tablet    # 768 × 1024 (barra lateral fija con la columna más angosta)
   npm run smoke:dist      # build + recorrido sobre dist/ml-system-design.html
   ```

   La prueba de humo recorre todas las páginas del curso a partir del registro, así que las nuevas
   quedan cubiertas (título, bloques sin errores, sin scroll horizontal); en cada caso listo también abre
   la solución sin practicar y revisa sus 15 secciones y diagramas, y en cada hoja de la parte 4 con
   contenido revisa sus secciones y anclas. Mira también la página con
   tus ojos en claro, oscuro y a 375 px de ancho.

## Bloques de contenido (referencia corta)

Cada sección es una lista de bloques `{ t: '<tipo>', … }`. En los campos de texto se permite HTML en
línea: `<b> <strong> <i> <em> <code> <a href="#m03"> <br> <sub> <sup> <kbd>`, `<span class="en">` para
inglés y `<span class="est">≈ 1,000 img/s</span>` para marcar una **estimación** (subrayado punteado +
"est."). Números con punto decimal y coma de miles (1,000.5); moneda `US$`. Los enlaces internos son
`#<página>` o `#<página>.<sección>` y funcionan aunque la página esté en Próximamente.

| tipo | campos | para qué |
|---|---|---|
| `p` | `html` | párrafo |
| `h3` | `text` | subtítulo dentro de la sección |
| `list` | `items[]`, `ordered?` | lista |
| `callout` | `kind`, `title?`, `html` | `why` El porqué · `trap` Trampa · `senior` Señal senior · `skip` Sáltate esto · `estimate` Estimación · `connect` Conexión · `interview` Cómo decirlo en la entrevista · `note` Nota |
| `table` | `head[]`, `rows[][]`, `caption?`, `note?` | comparación; la primera columna es el encabezado de fila (queda fija al desplazar) |
| `kv` | `items: [[etiqueta, valor, nota?]]` | números clave estilo hoja de datos |
| `steps` | `items: [{title, meta?, html}]` | secuencia numerada (solo si el orden es real) |
| `calc` | `title?`, `rows: [{label, expr, value, note?}]`, `result?` | cálculo back-of-the-envelope; acompáñalo de una frase con la decisión que implica |
| `qa` | `items: [{q, a, why?}]` | preguntas de aclaración con respuesta supuesta |
| `followups` | `items: [{q, junior, senior, why?}]` | preguntas del entrevistador: respuesta junior vs senior |
| `tradeoffs` | `items: [{option, verdict, pros, cons, why}]` | alternativas; `verdict`: `elegido` / `descartado` / `depende` |
| `checklist` | `id`, `items: [{id, html}]` | casillas que se guardan en el progreso |
| `quiz` | `items: [{q, options[], answer, explain}]` | autoevaluación (no se guarda) |
| `diagram` | `id`, `title`, `caption?`, `spec` | diagrama en unidades de grilla: `lanes`, `nodes`, `edges`, `flows` (recorridos guiados) — ver SPEC §5.4 |
| `code` | `title?`, `caption?`, `files: [{name, lang, src? \| code?, note?}]` | visor con pestañas, números de línea, resaltado y botón Copiar — ver SPEC §5.5 |
| `html` | `html` | escape (úsalo poco) |

Un bloque de tipo desconocido o mal formado se muestra como un aviso visible, nunca rompe la página.
Para ver todos los bloques juntos: `dev/blocks.html` (bloques) y `dev/components.html` (diagrama y
código).

## Herramientas

| comando | qué hace |
|---|---|
| `npm run validate` | valida catálogo y el contenido que carga `index.html` (`tools/validate-content.mjs`) |
| `npm run embed` | regenera `js/content/reference-files.js` desde `reference/**` |
| `npm test` | `node --test tests/*.test.cjs`: validador, embebido al día y pruebas del store (en Node 24, `node --test tests/` a secas no arranca: usa el patrón) |
| `npm run build` | embebe y genera `dist/ml-system-design.html` y `dist/artifact.html` |
| `npm run check` | abre `index.html` en Chrome headless e informa errores de consola |
| `npm run smoke` · `smoke:mobile` · `smoke:dark` · `smoke:tablet` · `smoke:dist` | prueba de humo en el navegador (`tools/smoke.js`), ver arriba |

`tools/browser-check.mjs` acepta `--url`, `--width/--height`, `--mobile`, `--dark` o `--light`,
`--wait`, `--eval "js"`, `--eval-file f.js`, `--shot ruta.png` y `--full`; usa Chrome en
`/Applications/Google Chrome.app` (o la variable `CHROME_PATH`) y sale con código 1 si la página
registra errores.

## Estructura

```
index.html              documento; carga css/ y js/ en el orden de SPEC §2.1
css/                    app.css (tokens, layout, bloques) · components.css (diagrama, código) · practice.css
js/core/                registry.js (catálogo, registro, plantillas) · store.js (estado y guardado)
js/ui/                  dom · blocks · diagram · code · practice · flashcards · reference · notes · drill · bank
js/content/             catalog.js · reference-files.js (generado) · un archivo por módulo/caso
js/app.js               router, barra lateral, búsqueda, páginas del shell
reference/c01/          archivos reales del caso C01 (gateway FastAPI, Triton, K8s, monitoreo…)
tools/                  validate-content · embed-reference · build-web · browser-check · smoke
web/                    manifest, íconos y service worker de la versión web (Vercel)
vercel.json             build y headers para Vercel (salida dist/web)
tests/                  pruebas de node:test
docs/SPEC.md            contrato interno de la app (formato de contenido, diseño, arquitectura)
```
