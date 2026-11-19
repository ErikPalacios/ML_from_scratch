# Video de TrueML (portada e Instagram)

Un recorrido de 79 s por las herramientas de TrueML con imágenes reales. Primero engancha con el Laboratorio
Transformer y el Atlas. Después muestra Sensei y el Dojo, que son por donde se empieza. Al final aparecen la Ronda,
las cheat sheets y el tablero. Sale en dos formatos con las mismas escenas y la misma pista:

- **Portada** (16:9, 1920×1080). En el hero de `apps/portada` corre una versión chica, en bucle y **sin sonido**,
  porque el navegador no deja arrancar un video solo si tiene audio. El sonido está en «Ver en grande», que la persona
  abre con un clic.
- **Instagram** (9:16, 1080×1920, para Reels). Lo importante queda entre y≈220 e y≈1600, porque arriba y abajo
  Instagram pone su interfaz.

## Cómo está hecho

1. **Grabaciones reales** (`tools/capturar.mjs`). Playwright abre cada app publicada en modo oscuro, en 1600×900 con
   escala 2 (o sea, cuadros de 3200×1800, para que la cámara pueda acercarse sin que se vea borroso), y hace lo que dice
   `tools/tomas.mjs`: dar clic, arrastrar sliders, desplazarse. Lo que se ve en pantalla se graba con el screencast de
   Chrome y ffmpeg lo convierte en `public/capturas/<toma>.mp4`. Un círculo amarillo hace de cursor.
2. **Montaje en Remotion** (`src/`). Cada escena coloca la grabación en una ventana de navegador inclinada en 3D,
   con una cámara que se acerca a lo importante y textos que suben palabra por palabra. Cada escena tiene un acomodo
   horizontal y otro vertical (`useVertical()`). La T de vidrio es el SVG real de `apps/trueml` (lo genera
   `tools/marca.mjs`) y se arma pieza por pieza. Entre escenas pasa un barrido con los seis colores de la T.
3. **Sonido hecho con código** (`tools/sonido.mjs`). Es música electrónica suave a 120 BPM en la menor
   (Am · F · C · G), sintetizada en Node, sin muestras ni música de terceros:
   - **La estructura:** sube durante el gancho, entra de lleno en el Laboratorio Transformer, baja en el puente y
     vuelve a subir en Sensei.
   - **Los efectos:** un «whoosh» en cada barrido, una nota de la escala pentatónica por cada pieza de la T (de datos
     a monitoreo) y golpes al empezar cada sección.
   - **El ritmo:** las escenas duran múltiplos de medio segundo (`src/tiempos.json`), así que los cortes caen en el pulso.
   - **El volumen:** queda normalizado a −14 LUFS, el que recomiendan las redes.
4. **Versiones para la web** (`tools/web.mjs`). A partir del render maestro saca un video chico de 960×540 (en WebM y
   MP4, sin audio) que corre en bucle en el hero, uno grande de 1080p con sonido para «Ver en grande» y el póster.
   Todo queda en `apps/portada/src/video/`.

## Comandos

```bash
npm install
npm run capturar          # vuelve a grabar todas las tomas (o: node tools/capturar.mjs ronda hojas)
npm run studio            # abre Remotion Studio para ajustar el montaje
npm run portada           # pista + render maestro + versiones web en apps/portada/src/video/
npm run instagram         # el vertical en out/instagram.mp4 (corre antes npm run sonido si cambiaste tiempos)
```

Hay que volver a grabar cuando una app cambie su diseño. Los tiempos de cada tramo (`desde`, `vel`, `dur`) y la
cámara (`cam`) están en `src/escenas.tsx`. Si una toma cambia de duración, revisa esos números. Si cambias la duración
de una escena en `src/tiempos.json`, vuelve a generar la pista (`npm run sonido`): los efectos se acomodan solos.

Para grabar se usa el Chromium que Playwright ya tiene descargado (`tools/navegador.mjs`). Con `CHROME=<ruta>` puedes
usar otro.

## Reels de Instagram (`src/reels/`)

> Para hacer piezas nuevas de Instagram (reels, carruseles, textos), empieza por [`INSTAGRAM.md`](INSTAGRAM.md).

Siete reels verticales (1080×1920) para abrir la cuenta. Hay uno por herramienta, más el recorrido completo:

| # | Reel | Gancho | Duración |
|---|---|---|---|
| 01 | Recorrido (la composición `Instagram`) | «¿Quieres entender ML engineering de verdad?» | 79 s |
| 02 | Laboratorio Transformer | «Esto es un transformer aprendiendo.» | 24 s |
| 03 | Sensei | «¿Cómo lee un LLM esta frase?» | 25,5 s |
| 04 | Dojo | «Constrúyelo. Rómpelo. Arréglalo.» | 25 s |
| 05 | Atlas de Arquitecturas | «¿Te piden dibujar ViT en la entrevista?» | 23 s |
| 06 | Ronda de Diseño ML | «Tienes 45 minutos para diseñar un sistema de ML.» | 23 s |
| 07 | Cheat sheets y tablero | «La noche antes de la entrevista:» | 23 s |

- **Las escenas:** `src/reels/reels.json` dice cuánto dura cada escena, dónde entra el barrido, el frame que sirve de
  portada y los efectos de sonido. Los componentes están en `src/reels/<Herramienta>.tsx`.
- **Las piezas:** en `src/reels/kit.tsx` está lo propio de los reels. El gancho ya se lee en el frame 0, la aurora
  usa los seis colores de la T, y el cierre es el mismo en todos: la T, «Gratis · Sin cuenta · En español» y el link.
  Lo demás sale de `src/piezas.tsx`. La `Ventana` acepta `proporcion` para mostrar la grabación más alta.
- **El sonido:** cada reel tiene su propia pista (`tools/sonido-reel.mjs`), hecha con el mismo sintetizador que el
  video completo (`tools/sintes.mjs`). El pad y el arpegio suenan desde el primer segundo, y el bombo entra justo
  cuando termina el gancho.
- **Los textos:** el de cada publicación está en `src/reels/textos/<id>.txt`.

```bash
node tools/reels.mjs                      # los siete: pista, video, portada (PNG) y texto en out/reels/
node tools/reels.mjs 04-dojo              # solo uno
tools/hoja-reel.sh out/reels/04-dojo.mp4 hoja.png   # hoja de contacto con las líneas de la zona segura
```

Orden sugerido para publicar los siete el mismo día: 07 → 06 → 05 → 04 → 03 → 02 → 01, y luego fijar el 01. Así
el perfil queda con el recorrido, el Transformer y Sensei arriba.

## Videos explicativos (cómo se usa cada herramienta)

Siete videos de 16:9 (1920×1080) en `src/tutoriales/`. Tres son tutoriales completos, de unos 2 a 2.5 minutos: **Sensei**,
**el Dojo** y **el tablero de proyectos** (la demo pública). Los otros cuatro son muestras de unos 30 s: el
Laboratorio Transformer, el Atlas, la Ronda y las cheat sheets. Todos usan el mismo formato:

- **A la izquierda**, la lista de pasos. El paso actual se enciende y los anteriores llevan una palomita.
- **A la derecha**, la grabación real dentro de una ventana casi plana, para que se lea. La cámara se acerca a lo
  importante y un aro rodea el botón o el bloque del que se habla.
- **Abajo**, el subtítulo que explica qué está pasando. Las palabras entre `*asteriscos*` salen resaltadas.

Cómo se arma:

1. **Las tomas** están en `tools/tomas-tutoriales.mjs`. Mientras graba, `marcar(p, selector, id)` anota en qué segundo
   y en qué lugar de la pantalla está cada elemento. Esas marcas se guardan en `src/marcas.json`, y
   `momento(p, id)` anota solo el segundo.
2. **Los guiones** (`src/tutoriales/sensei.ts`, `dojo.ts`, `tablero.ts`, `muestras.ts`) usan esas marcas para todo:
   - Cada tramo de grabación va de una marca a otra (`de`, `a`).
   - La cámara apunta a una marca (`m`) en el instante de otra (`fm`).
   - Cada subtítulo entra cuando la grabación llega a su marca.

   Así, si vuelves a grabar y la página tarda distinto, el montaje se acomoda solo.
3. **La pista** (`tools/sonido-tutorial.mjs`) es un fondo tranquilo para leer, sin bombo. Lleva una nota al empezar
   cada paso y un barrido al entrar y al salir. Lee los tiempos del guion compilándolo con esbuild.

```bash
node tools/capturar.mjs sen-inicio dojo-t-mapa tab-mapa   # graba tomas (sin nombres: todas, también las del video de portada)
npm run tutoriales                                        # pista + video + póster de los siete en out/tutoriales/
node tools/tutoriales.mjs sensei                          # solo uno
```

Si una toma falla porque cambió un selector, el video que la usa desaparece de Remotion Studio (con un aviso) hasta
que la vuelvas a grabar. Los demás videos no se afectan.
